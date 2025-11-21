import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  metrics,
  voice,
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { TaskFunctionContext } from './task-function-context.js';
import { startHealthCheckServer } from './health-check.js';
import { playGreeting } from './greeting.js';

// Load .env.local if it exists (for local development)
// In production (Railway), environment variables are set directly
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env.local' });
}

// Start health check server only in the main worker process, not in job processes
// Check if this is the main process by looking for the worker mode
const isMainWorker = process.argv.includes('dev') || process.argv.includes('start');
if (isMainWorker) {
  const healthCheckPort = parseInt(process.env.HEALTH_CHECK_PORT || '8080', 10);
  startHealthCheckServer(healthCheckPort);
}

/**
 * Task management assistant that handles CRUD operations via voice commands
 */
class TaskAssistant extends voice.Agent {
  constructor(taskContext: TaskFunctionContext, userTimezone: string = 'UTC') {
    // Get current date/time in user's timezone using proper date formatting
    const now = new Date();
    
    // Format dates in user's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    
    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    const dayOfWeek = parts.find(p => p.type === 'weekday')?.value || '';
    
    const currentDate = `${year}-${month}-${day}`; // YYYY-MM-DD
    const timeString = now.toLocaleTimeString('en-US', { timeZone: userTimezone, hour12: true });
    
    // Calculate example dates by adding days to current date
    const todayDate = new Date(`${currentDate}T00:00:00Z`);
    
    const tomorrow = new Date(todayDate);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const dayAfterTomorrow = new Date(todayDate);
    dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 2);
    const dayAfterTomorrowStr = dayAfterTomorrow.toISOString().split('T')[0];
    
    super({
      instructions: `You are a minimal, efficient task management assistant. Speak only when necessary.

CURRENT DATE/TIME (${userTimezone}):
Today: ${dayOfWeek}, ${currentDate} | Time: ${timeString}

DATE PARSING (CRITICAL):
- "today" = ${currentDate}
- "tomorrow" = ${tomorrowStr}
- "day after tomorrow" = ${dayAfterTomorrowStr}
- "in X days" = add X days to ${currentDate}
- "next week" = add 7 days to ${currentDate}
Use ISO 8601 format: YYYY-MM-DDTHH:MM:SS.000Z

RESPONSE RULES (CRITICAL - Follow strictly):
1. MINIMAL SPEECH: Only speak to:
   - Confirm completed actions (1 short sentence)
   - Ask for missing required information
   - Clarify ambiguous requests
   - Report errors

2. NO UNNECESSARY TALK:
   - Don't greet or make small talk
   - Don't explain what you're doing
   - Don't ask "Is there anything else?"
   - Don't repeat information already on screen

3. TASK LISTING:
   - NEVER read tasks aloud automatically
   - Just say: "Found X tasks" (tasks shown on screen)
   - Only read aloud if user explicitly asks

4. CONFIRMATIONS (keep ultra-short):
   - Created: "Task created"
   - Updated: "Updated"
   - Deleted: "Deleted"
   - Completed: "Marked complete"

5. CLARIFICATIONS (only when needed):
   - Multiple matches: "Which task? 1, 2, or 3?"
   - Missing info: "What's the task title?"
   - Ambiguous: "Did you mean task 1 or 2?"

TASK OPERATIONS:
- Create: title (required), scheduled_time, priority, tags
- Get: query, priority, scheduled filters
- Update: identifier (number/title), any field
- Delete: identifier (number/title)

Execute tools immediately. Speak minimally.`,

      // Register all CRUD operation tools from the task context
      tools: {
        create_task: taskContext.create_task,
        get_tasks: taskContext.get_tasks,
        update_task: taskContext.update_task,
        delete_task: taskContext.delete_task,
      },
    });
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    // No prewarm needed for OpenAI Realtime API
    // The Realtime API handles VAD internally
  },
  entry: async (ctx: JobContext) => {
    console.log('Starting voice agent for task management with OpenAI Realtime API...');
    console.log('Environment check:', {
      hasLivekitUrl: !!process.env.LIVEKIT_URL,
      hasLivekitKey: !!process.env.LIVEKIT_API_KEY,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      nodeEnv: process.env.NODE_ENV,
    });

    // Extract timezone from job metadata (passed during dispatch)
    let userTimezone = 'UTC';
    let timezoneOffset = 0;
    try {
      // Try to get metadata from job first, then fall back to room
      const metadataStr = ctx.job.metadata || ctx.room.metadata;
      console.log('Raw metadata:', metadataStr);
      
      if (metadataStr) {
        const parsed = JSON.parse(metadataStr);
        userTimezone = parsed.timezone || 'UTC';
        timezoneOffset = parsed.timezoneOffset || 0;
        console.log(`User timezone: ${userTimezone} (offset: ${timezoneOffset} minutes)`);
      } else {
        console.log('No metadata found, using UTC');
      }
    } catch (err) {
      console.warn('Failed to parse metadata for timezone:', err);
    }

    // Set up voice AI pipeline with OpenAI Realtime API
    // This provides an all-in-one speech-to-speech solution with:
    // - Built-in STT (speech-to-text)
    // - LLM processing with function calling
    // - Built-in TTS (text-to-speech)
    // - Automatic VAD (voice activity detection)
    // - Lower latency than separate STT/LLM/TTS pipeline
    const sessionOptions: any = {
      // OpenAI Realtime API - handles STT, LLM, and TTS in one model
      // Using gpt-realtime-mini for cost-effective operation
      llm: new openai.realtime.RealtimeModel({
        model: 'gpt-realtime-mini', // Cost-effective realtime model
        voice: 'alloy', // Natural, friendly, gender-neutral voice
        temperature: 0.7, // Balanced creativity for natural responses
        // Server VAD configuration for turn detection
        turnDetection: {
          type: 'server_vad',
          threshold: 0.47, // Sensitivity to voice (0.0-1.0, higher = less sensitive)
          prefix_padding_ms: 300, // Audio to include before speech starts
          silence_duration_ms: 500, // Silence duration to detect speech end
          create_response: true, // Automatically create response after user stops
          interrupt_response: true, // Allow user to interrupt agent
        },
      }),
    };

    const session = new voice.AgentSession(sessionOptions);

    // Metrics collection for monitoring pipeline performance
    const usageCollector = new metrics.UsageCollector();
    
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      metrics.logMetrics(ev.metrics);
      usageCollector.collect(ev.metrics);
      conversationTurnCount++;
    });

    // Log usage summary on shutdown
    const logUsage = async () => {
      const summary = usageCollector.getSummary();
      console.log(`Usage Summary: ${JSON.stringify(summary, null, 2)}`);
    };

    ctx.addShutdownCallback(logUsage);

    // Track conversation state for debugging and monitoring
    let conversationTurnCount = 0;

    // Initialize the task function context with CRUD operations
    const taskFunctionContext = new TaskFunctionContext(ctx.room);

    // Join the room and connect to the user first
    await ctx.connect();
    console.log('Connected to room:', ctx.room.name);

    // Start the session with the task assistant
    await session.start({
      agent: new TaskAssistant(taskFunctionContext, userTimezone),
      room: ctx.room,
      // Note: OpenAI Realtime API handles noise internally
    });

    console.log('Voice agent session started successfully');
    console.log('Using OpenAI Realtime API (gpt-realtime-mini)');
    console.log('Voice: alloy (built-in STT, LLM, and TTS)');

    // Play greeting message after session starts
    // This ensures the TTS pipeline is ready
    await playGreeting(ctx, session);

    console.log('Agent is ready to receive voice commands');

    // Log when participant joins
    ctx.room.on('participantConnected', (participant) => {
      console.log(`Participant connected: ${participant.identity}`);
    });

    ctx.room.on('participantDisconnected', (participant) => {
      console.log(`Participant disconnected: ${participant.identity}`);
      console.log(`Total conversation turns: ${conversationTurnCount}`);
    });
  },
});

// Set up cleanup on process exit
async function cleanupOnExit() {
  console.log('\n🧹 Cleaning up agent dispatches...');
  try {
    const { AgentDispatchClient } = await import('livekit-server-sdk');
    
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      console.log('⚠️  Missing LiveKit credentials, skipping cleanup');
      return;
    }

    const livekitHost = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    const client = new AgentDispatchClient(livekitHost, apiKey, apiSecret);
    
    const roomName = 'voice-todo-room';
    const dispatches = await client.listDispatch(roomName);
    
    console.log(`Found ${dispatches.length} agent dispatch(es) to clean up`);

    let deletedCount = 0;
    for (const dispatch of dispatches) {
      try {
        await client.deleteDispatch(dispatch.id, roomName);
        console.log(`✓ Deleted dispatch: ${dispatch.id}`);
        deletedCount++;
      } catch (err) {
        // Ignore errors during cleanup
      }
    }

    console.log(`✅ Cleanup complete: ${deletedCount}/${dispatches.length} dispatches removed`);
  } catch (err) {
    console.log('⚠️  Cleanup failed:', err instanceof Error ? err.message : 'Unknown error');
  }
}

// Handle graceful shutdown
let isShuttingDown = false;

process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('\n\nReceived SIGINT, shutting down gracefully...');
  await cleanupOnExit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('\n\nReceived SIGTERM, shutting down gracefully...');
  await cleanupOnExit();
  process.exit(0);
});

cli.runApp(new WorkerOptions({ 
  agent: fileURLToPath(import.meta.url),
  agentName: 'task-assistant', // Enable explicit dispatch
}));
