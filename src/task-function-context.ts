import { llm } from '@livekit/agents';
import { z } from 'zod';
import { withRetry, formatErrorForTTS } from './retry-utils';
import { parseNaturalDate } from './date-parser';

/**
 * Task interface matching the Next.js API response
 */
interface Task {
  id: string;
  title: string;
  completed: boolean;
  scheduled_time: string | null;
  priority_index: number | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

/**
 * TaskFunctionContext provides LLM-callable functions for task CRUD operations.
 * This class provides tools that enable the LLM to interact with the Next.js API
 * for task management.
 */
export class TaskFunctionContext {
  private apiBaseUrl: string;
  private room: any; // LiveKit Room instance

  constructor(room?: any) {
    // Get API base URL from environment variable
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    this.room = room;
    
    console.log(`TaskFunctionContext initialized with API base URL: ${this.apiBaseUrl}`);
  }

  /**
   * Send a data message to the frontend to trigger UI updates
   */
  private async sendDataToFrontend(data: { type: string; payload?: any }) {
    if (!this.room) return;
    
    try {
      const message = JSON.stringify(data);
      await this.room.localParticipant.publishData(
        new TextEncoder().encode(message),
        { reliable: true }
      );
      console.log('Sent data to frontend:', data.type);
    } catch (err) {
      console.warn('Failed to send data to frontend:', err);
    }
  }

  /**
   * HTTP client utility with error handling and retry logic
   * Makes a fetch request and handles common error scenarios
   */
  private async fetchWithErrorHandling(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    return withRetry(
      async () => {
        // Set default headers
        const headers = {
          'Content-Type': 'application/json',
          ...options.headers,
        };

        const response = await fetch(url, {
          ...options,
          headers,
        });

        // Check for HTTP errors
        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`HTTP ${response.status} error from ${url}:`, errorBody);
          throw new Error(`API request failed with status ${response.status}`);
        }

        return response;
      },
      {
        maxRetries: 2,
        initialDelayMs: 500,
        timeoutMs: 8000, // 8 second timeout for API calls
      }
    );
  }

  /**
   * Helper method to fetch all tasks from the API
   * Used internally by resolveTaskIdentifier and get_tasks
   */
  private async getAllTasks(): Promise<Task[]> {
    const url = `${this.apiBaseUrl}/api/tasks`;
    const response = await this.fetchWithErrorHandling(url);
    return await response.json();
  }

  /**
   * Resolve a task identifier to a task ID
   * Handles both ordinal references (e.g., "4th", "fourth") and semantic matching
   * 
   * @param identifier - Task identifier (ordinal or title substring)
   * @returns Task ID
   * @throws Error if no match or multiple matches found
   */
  private async resolveTaskIdentifier(identifier: string): Promise<string> {
    console.log(`Resolving task identifier: "${identifier}"`);

    // Parse plain numbers (e.g., "1", "2", "3")
    const plainNumberMatch = identifier.match(/^\d+$/);
    if (plainNumberMatch) {
      const index = parseInt(identifier, 10) - 1; // Convert to 0-based index
      console.log(`Parsed plain number reference: position ${index + 1}`);
      
      const tasks = await this.getAllTasks();
      
      if (index < 0 || index >= tasks.length) {
        throw new Error(`Task number ${index + 1} doesn't exist. You have ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`);
      }
      
      const task = tasks[index];
      if (!task) {
        throw new Error(`Task number ${index + 1} doesn't exist.`);
      }
      console.log(`Resolved to task: ${task.id} - "${task.title}"`);
      return task.id;
    }

    // Parse ordinal references (e.g., "4th", "fourth", "1st", "2nd", "3rd")
    const ordinalMatch = identifier.match(/(\d+)(st|nd|rd|th)/i);
    
    if (ordinalMatch && ordinalMatch[1]) {
      const index = parseInt(ordinalMatch[1], 10) - 1; // Convert to 0-based index
      console.log(`Parsed ordinal reference: position ${index + 1}`);
      
      const tasks = await this.getAllTasks();
      
      if (index < 0 || index >= tasks.length) {
        throw new Error(`Task number ${index + 1} doesn't exist. You have ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`);
      }
      
      const task = tasks[index];
      if (!task) {
        throw new Error(`Task number ${index + 1} doesn't exist.`);
      }
      console.log(`Resolved to task: ${task.id} - "${task.title}"`);
      return task.id;
    }

    // Handle semantic matching using title substring search
    console.log('Attempting semantic matching on task titles');
    const tasks = await this.getAllTasks();
    const lowerIdentifier = identifier.toLowerCase();
    
    const matches = tasks.filter((task) =>
      task.title.toLowerCase().includes(lowerIdentifier)
    );

    console.log(`Found ${matches.length} matching tasks`);

    if (matches.length === 0) {
      throw new Error(`No task found matching "${identifier}". Please try a different description.`);
    }

    if (matches.length > 1) {
      // List the matching tasks for clarification
      const matchList = matches
        .map((task, idx) => `${idx + 1}. ${task.title}`)
        .join(', ');
      throw new Error(
        `Multiple tasks match "${identifier}": ${matchList}. Please be more specific or use a task number.`
      );
    }

    // Exactly one match found
    const task = matches[0];
    if (!task) {
      throw new Error(`No task found matching "${identifier}".`);
    }
    console.log(`Resolved to task: ${task.id} - "${task.title}"`);
    return task.id;
  }

  /**
   * Create a new task tool
   */
  create_task = llm.tool({
    description: 'Create a task',
    parameters: z.object({
      title: z.string().describe('Task title'),
      scheduled_time: z
        .string()
        .nullish()
        .describe('When due (e.g., "tomorrow", "next Monday", ISO 8601)'),
      priority_index: z
        .number()
        .min(1)
        .max(5)
        .nullish()
        .describe('Priority 1-5 (1=low, 5=high)'),
      tags: z
        .array(z.string())
        .nullish()
        .describe('Tags array'),
    }),
    execute: async ({ title, scheduled_time, priority_index, tags }) => {
      try {
        console.log(`Creating task: "${title}"`, {
          scheduled_time,
          priority_index,
          tags,
        });

        // Build request body
        const body: Record<string, unknown> = { title };
        
        // Parse natural language date if provided
        if (scheduled_time) {
          try {
            const parsedDate = parseNaturalDate(scheduled_time);
            body.scheduled_time = parsedDate;
            console.log(`Parsed date "${scheduled_time}" to ${parsedDate}`);
          } catch (dateError) {
            // Return user-friendly error message for date parsing failures
            if (dateError instanceof Error) {
              return dateError.message;
            }
            return `I couldn't understand the date "${scheduled_time}". Please try a different format.`;
          }
        }
        
        // Set priority - default to 1 (lowest) if not specified
        if (priority_index !== undefined && priority_index !== null) {
          body.priority_index = priority_index;
        } else {
          body.priority_index = 1; // Default to lowest priority
          console.log('No priority specified, defaulting to 1 (lowest)');
        }
        
        if (tags && tags.length > 0) {
          body.tags = tags;
        }

        // Call Next.js API
        const url = `${this.apiBaseUrl}/api/tasks`;
        const response = await this.fetchWithErrorHandling(url, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        const task: Task = await response.json();
        
        console.log(`Task created successfully: ${task.id}`);

        // Notify frontend to refresh tasks
        await this.sendDataToFrontend({ type: 'TASK_CREATED' });

        // Format success response for TTS
        let message = `Created task: ${task.title}`;
        
        if (task.scheduled_time) {
          const date = new Date(task.scheduled_time);
          message += ` scheduled for ${this.formatDate(date)}`;
        }
        
        if (task.priority_index) {
          message += ` with priority ${task.priority_index}`;
        }

        return message;
      } catch (error) {
        console.error('Error creating task:', error);
        
        if (error instanceof Error) {
          return formatErrorForTTS(error, 'create that task');
        }
        
        return "I couldn't create that task. Please try again.";
      }
    },
  });

  /**
   * Helper method to format dates for TTS output
   */
  private formatDate(date: Date): string {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Check if it's today
    if (date.toDateString() === now.toDateString()) {
      return 'today';
    }
    
    // Check if it's tomorrow
    if (date.toDateString() === tomorrow.toDateString()) {
      return 'tomorrow';
    }
    
    // Format as readable date
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    };
    
    return date.toLocaleDateString('en-US', options);
  }

  /**
   * Get tasks tool
   */
  get_tasks = llm.tool({
    description: 'Retrieve and list all tasks or search for specific tasks. Use this when the user asks to see their tasks, show tasks, list tasks, or get tasks.',
    parameters: z.object({
      query: z.string().nullish().describe('Search by title'),
      priority: z
        .number()
        .min(1)
        .max(5)
        .nullish()
        .describe('Filter by priority 1-5'),
      scheduled: z.string().nullish().describe('Filter by date (ISO 8601)'),
    }),
    execute: async ({ query, priority, scheduled }) => {
      try {
        console.log('Fetching tasks with filters:', { query, priority, scheduled });

        // Build query parameters
        const params = new URLSearchParams();
        
        if (query) {
          params.append('query', query);
        }
        
        if (priority !== undefined && priority !== null) {
          params.append('priority', priority.toString());
        }
        
        if (scheduled) {
          params.append('scheduled', scheduled);
        }

        // Call Next.js API
        const url = `${this.apiBaseUrl}/api/tasks${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await this.fetchWithErrorHandling(url);
        const tasks: Task[] = await response.json();

        console.log(`Retrieved ${tasks.length} tasks`);

        // Notify frontend to apply filters
        await this.sendDataToFrontend({
          type: 'APPLY_FILTERS',
          payload: { query, priority, scheduled }
        });

        // Handle empty results
        if (tasks.length === 0) {
          if (query || priority || scheduled) {
            return "You have no tasks matching that criteria.";
          }
          return "You have no tasks. Your to-do list is empty.";
        }

        // Format tasks for TTS (numbered list with due dates)
        const taskDescriptions = tasks.map((task, index) => {
          let description = `${index + 1}. ${task.title}`;
          
          if (task.scheduled_time) {
            const date = new Date(task.scheduled_time);
            description += ` due ${this.formatDate(date)}`;
          }
          
          if (task.priority_index) {
            description += ` priority ${task.priority_index}`;
          }
          
          if (task.completed) {
            description += ' completed';
          }
          
          return description;
        });

        // Join with periods for natural speech
        const message = `You have ${tasks.length} task${tasks.length === 1 ? '' : 's'}. ${taskDescriptions.join('. ')}.`;
        
        return message;
      } catch (error) {
        console.error('Error fetching tasks:', error);
        
        if (error instanceof Error) {
          return formatErrorForTTS(error, 'retrieve your tasks');
        }
        
        return "I couldn't retrieve your tasks. Please try again.";
      }
    },
  });

  /**
   * Update task tool
   */
  update_task = llm.tool({
    description: 'Update task by number or title',
    parameters: z.object({
      identifier: z
        .string()
        .describe('Task number (e.g., "4th") or title substring'),
      title: z.string().nullish().describe('New title'),
      scheduled_time: z.string().nullish().describe('New date (e.g., "tomorrow", ISO 8601)'),
      priority_index: z
        .number()
        .min(1)
        .max(5)
        .nullish()
        .describe('New priority 1-5'),
      completed: z.boolean().nullish().describe('Completion status'),
    }),
    execute: async ({ identifier, title, scheduled_time, priority_index, completed }) => {
      try {
        console.log(`Updating task: "${identifier}"`, {
          title,
          scheduled_time,
          priority_index,
          completed,
        });

        // Resolve identifier to task ID
        const taskId = await this.resolveTaskIdentifier(identifier);

        // Build update body - only include non-null values
        const body: Record<string, unknown> = {};
        
        if (title !== undefined && title !== null) {
          body.title = title;
        }
        
        // Parse natural language date if provided
        if (scheduled_time !== undefined && scheduled_time !== null) {
          try {
            const parsedDate = parseNaturalDate(scheduled_time);
            body.scheduled_time = parsedDate;
            console.log(`Parsed date "${scheduled_time}" to ${parsedDate}`);
          } catch (dateError) {
            // Return user-friendly error message for date parsing failures
            if (dateError instanceof Error) {
              return dateError.message;
            }
            return `I couldn't understand the date "${scheduled_time}". Please try a different format.`;
          }
        }
        
        if (priority_index !== undefined && priority_index !== null) {
          body.priority_index = priority_index;
        }
        
        if (completed !== undefined && completed !== null) {
          body.completed = completed;
        }

        // Ensure at least one field is being updated
        if (Object.keys(body).length === 0) {
          return "No changes specified. Please tell me what you'd like to update.";
        }

        // Call Next.js API
        const url = `${this.apiBaseUrl}/api/tasks/${taskId}`;
        const response = await this.fetchWithErrorHandling(url, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });

        const task: Task = await response.json();
        
        console.log(`Task updated successfully: ${task.id}`);

        // Notify frontend to refresh tasks
        await this.sendDataToFrontend({ type: 'TASK_UPDATED' });

        // Format success response for TTS
        let message = `Updated task: ${task.title}`;
        
        const updates: string[] = [];
        
        if (title !== undefined) {
          updates.push('title changed');
        }
        
        if (scheduled_time !== undefined && task.scheduled_time) {
          const date = new Date(task.scheduled_time);
          updates.push(`rescheduled to ${this.formatDate(date)}`);
        }
        
        if (priority_index !== undefined) {
          updates.push(`priority set to ${task.priority_index}`);
        }
        
        if (completed !== undefined) {
          updates.push(task.completed ? 'marked as complete' : 'marked as incomplete');
        }
        
        if (updates.length > 0) {
          message += `. ${updates.join(', ')}`;
        }

        return message;
      } catch (error) {
        console.error('Error updating task:', error);
        
        // Return the error message if it's a clarification request
        if (error instanceof Error) {
          // Check if it's a user-facing clarification message
          if (
            error.message.includes('Multiple tasks match') ||
            error.message.includes('No task found') ||
            error.message.includes("doesn't exist")
          ) {
            return error.message;
          }
          
          // Otherwise format as TTS error
          return formatErrorForTTS(error, 'update that task');
        }
        
        return "I couldn't update that task. Please try again.";
      }
    },
  });

  /**
   * Delete task tool
   */
  delete_task = llm.tool({
    description: 'Delete task by number or title',
    parameters: z.object({
      identifier: z
        .string()
        .describe('Task number (e.g., "4th") or title substring'),
    }),
    execute: async ({ identifier }) => {
      try {
        console.log(`Deleting task: "${identifier}"`);

        // Resolve identifier to task ID
        const taskId = await this.resolveTaskIdentifier(identifier);

        // Call Next.js API
        const url = `${this.apiBaseUrl}/api/tasks/${taskId}`;
        const response = await this.fetchWithErrorHandling(url, {
          method: 'DELETE',
        });

        const task: Task = await response.json();
        
        console.log(`Task deleted successfully: ${task.id}`);

        // Notify frontend to refresh tasks
        await this.sendDataToFrontend({ type: 'TASK_DELETED' });

        // Format success response for TTS
        return `Deleted task: ${task.title}`;
      } catch (error) {
        console.error('Error deleting task:', error);
        
        // Return the error message if it's a clarification request
        if (error instanceof Error) {
          // Check if it's a user-facing clarification message
          if (
            error.message.includes('Multiple tasks match') ||
            error.message.includes('No task found') ||
            error.message.includes("doesn't exist")
          ) {
            return error.message;
          }
          
          // Otherwise format as TTS error
          return formatErrorForTTS(error, 'delete that task');
        }
        
        return "I couldn't delete that task. Please try again.";
      }
    },
  });
}
