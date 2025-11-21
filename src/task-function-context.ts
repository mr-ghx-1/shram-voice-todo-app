import { llm } from '@livekit/agents';
import { z } from 'zod';
import { withRetry, formatErrorForTTS } from './retry-utils.js';
import { parseNaturalDate } from './date-parser.js';
import { parsePriority, formatPriority } from './priority-mapper.js';

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
    description: 'Create a task. Priority can be specified using keywords (low, normal, high, urgent, critical) or numbers 1-5.',
    parameters: z.object({
      title: z.string().describe('Task title'),
      scheduled_time: z
        .string()
        .nullish()
        .describe('When due (e.g., "tomorrow", "next Monday", ISO 8601)'),
      priority: z
        .union([z.string(), z.number()])
        .nullish()
        .describe('Priority keyword (low, normal, high, urgent, critical) or number 1-5 (1=low, 5=critical)'),
      tags: z
        .array(z.string())
        .nullish()
        .describe('Tags array'),
    }),
    execute: async ({ title, scheduled_time, priority, tags }) => {
      try {
        console.log(`Creating task: "${title}"`, {
          scheduled_time,
          priority,
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
        
        // Parse priority keyword or number to numeric value
        const priorityValue = parsePriority(priority);
        if (priorityValue !== null) {
          body.priority_index = priorityValue;
          console.log(`Parsed priority "${priority}" to ${priorityValue}`);
        } else if (priority !== undefined && priority !== null) {
          // Invalid priority provided
          console.warn(`Invalid priority value: "${priority}"`);
          return `I couldn't understand the priority "${priority}". Please use low, normal, high, urgent, critical, or a number from 1 to 5.`;
        } else {
          // Default to 1 (lowest) if not specified
          body.priority_index = 1;
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

        // Format success response for TTS (minimal)
        return 'Task created';
      } catch (error) {
        console.error('Error creating task:', error);
        
        if (error instanceof Error) {
          return formatErrorForTTS(error, 'create that task');
        }
        
        return "Couldn't create task";
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
    description: 'Retrieve and list all tasks or search for specific tasks. Use this when the user asks to see their tasks, show tasks, list tasks, or get tasks. Priority can be specified using keywords (low, normal, high, urgent, critical) or numbers 1-5. Leave all parameters empty/null to get all tasks.',
    parameters: z.object({
      query: z.string().nullish().describe('Search by title (leave empty for all tasks)'),
      priority: z
        .union([z.string(), z.number()])
        .nullish()
        .describe('Filter by priority keyword (low, normal, high, urgent, critical) or number 1-5 (leave empty for all priorities)'),
      scheduled: z.string().nullish().describe('Filter by specific date in ISO 8601 format (e.g., "2024-12-25"). Leave empty to get tasks with any or no scheduled date.'),
    }),
    execute: async ({ query, priority, scheduled }) => {
      try {
        console.log('Fetching tasks with filters:', { query, priority, scheduled });

        // Build query parameters
        const params = new URLSearchParams();
        
        if (query) {
          params.append('query', query);
        }
        
        // Parse priority keyword or number to numeric value
        const priorityValue = parsePriority(priority);
        if (priorityValue !== null) {
          params.append('priority', priorityValue.toString());
          console.log(`Parsed priority filter "${priority}" to ${priorityValue}`);
        } else if (priority !== undefined && priority !== null) {
          // Invalid priority provided
          console.warn(`Invalid priority filter: "${priority}"`);
          return `I couldn't understand the priority "${priority}". Please use low, normal, high, urgent, critical, or a number from 1 to 5.`;
        }
        
        // Only add scheduled parameter if it's a valid ISO 8601 date
        // Ignore values like "all" or empty strings
        if (scheduled && scheduled !== 'all' && scheduled.trim() !== '') {
          // Basic validation for ISO 8601 format
          const isoDateRegex = /^\d{4}-\d{2}-\d{2}/;
          if (isoDateRegex.test(scheduled)) {
            params.append('scheduled', scheduled);
          } else {
            console.warn(`Invalid scheduled date format: "${scheduled}"`);
          }
        }

        // Call Next.js API
        const url = `${this.apiBaseUrl}/api/tasks${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await this.fetchWithErrorHandling(url);
        const tasks: Task[] = await response.json();

        console.log(`Retrieved ${tasks.length} tasks`);

        // Notify frontend to apply filters (use parsed priority value)
        await this.sendDataToFrontend({
          type: 'APPLY_FILTERS',
          payload: { query, priority: priorityValue, scheduled }
        });

        // Handle empty results
        if (tasks.length === 0) {
          if (query || priority || scheduled) {
            return "No tasks found";
          }
          return "No tasks";
        }

        // Minimal response - tasks are shown on screen
        return `Found ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
      } catch (error) {
        console.error('Error fetching tasks:', error);
        
        if (error instanceof Error) {
          return formatErrorForTTS(error, 'retrieve your tasks');
        }
        
        return "Couldn't get tasks";
      }
    },
  });

  /**
   * Update task tool
   */
  update_task = llm.tool({
    description: 'Update task by number or title. Priority can be specified using keywords (low, normal, high, urgent, critical) or numbers 1-5.',
    parameters: z.object({
      identifier: z
        .string()
        .describe('Task number (e.g., "4th") or title substring'),
      title: z.string().nullish().describe('New title'),
      scheduled_time: z.string().nullish().describe('New date (e.g., "tomorrow", ISO 8601)'),
      priority: z
        .union([z.string(), z.number()])
        .nullish()
        .describe('New priority keyword (low, normal, high, urgent, critical) or number 1-5'),
      completed: z.boolean().nullish().describe('Completion status'),
    }),
    execute: async ({ identifier, title, scheduled_time, priority, completed }) => {
      try {
        console.log(`Updating task: "${identifier}"`, {
          title,
          scheduled_time,
          priority,
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
        
        // Parse priority keyword or number to numeric value
        if (priority !== undefined && priority !== null) {
          const priorityValue = parsePriority(priority);
          if (priorityValue !== null) {
            body.priority_index = priorityValue;
            console.log(`Parsed priority "${priority}" to ${priorityValue}`);
          } else {
            // Invalid priority provided
            console.warn(`Invalid priority value: "${priority}"`);
            return `I couldn't understand the priority "${priority}". Please use low, normal, high, urgent, critical, or a number from 1 to 5.`;
          }
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

        // Format success response for TTS (minimal)
        if (completed !== undefined) {
          return task.completed ? 'Marked complete' : 'Marked incomplete';
        }
        
        return 'Updated';
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
        
        return "Couldn't update task";
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

        // Format success response for TTS (minimal)
        return 'Deleted';
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
        
        return "Couldn't delete task";
      }
    },
  });
}
