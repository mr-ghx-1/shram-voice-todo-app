import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  metrics,
  voice,
} from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { TaskFunctionContext } from './task-function-context.js';
import { startHealthCheckServer } from './health-check.js';

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
      instructions: `You are a task management voice assistant. Help users manage their to-do list via voice commands.

IMPORTANT: Current date and time information (User timezone: ${userTimezone}):
- Today is ${dayOfWeek}, ${currentDate}
- Current local time: ${timeString}

DATE CALCULATION EXAMPLES (CRITICAL - Follow these exactly):
- "today" = ${currentDate}
- "tomorrow" = ${tomorrowStr} (add 1 day)
- "day after tomorrow" = ${dayAfterTomorrowStr} (add 2 days)
- "in 3 days" = add 3 days to ${currentDate}
- "next week" = add 7 days to ${currentDate}

Always use ISO 8601 format for scheduled_time (YYYY-MM-DDTHH:MM:SS.000Z)
Convert user's local dates to UTC for storage

Core functions:
- Create tasks (with optional scheduling/priority)
- View/search tasks
- Update tasks (reschedule, priority, completion)
- Delete tasks

Response guidelines:
- Be concise and natural
- Confirm actions clearly (e.g., "Created task: Buy groceries")
- When listing/filtering tasks: DO NOT read them aloud automatically
  * Instead say: "I found X tasks [with your criteria]. They're displayed on screen. Would you like me to read them out?"
  * Only read tasks aloud if user explicitly asks
- Ask for clarification if task reference is ambiguous
- Always use provided tools for operations

Task references:
- By number: "4th task" → use ordinal
- By description: "task about groceries" → use semantic match
- Dates: Parse "tomorrow", "next Monday", "in 3 days" relative to ${currentDate}

Use tools to manage tasks efficiently.`,

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
    // Prewarm VAD model for faster startup
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    console.log('Starting voice agent for task management...');
    console.log('Environment check:', {
      hasLivekitUrl: !!process.env.LIVEKIT_URL,
      hasLivekitKey: !!process.env.LIVEKIT_API_KEY,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasDeepgram: !!process.env.DEEPGRAM_API_KEY,
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

    // Set up voice AI pipeline with Deepgram STT, OpenAI LLM, and OpenAI TTS
    const sessionOptions: any = {
      // Deepgram STT - converts user speech to text
      // Using streaming mode for real-time transcription with low latency
      // nova-2-general provides best accuracy for conversational speech
      stt: new deepgram.STT({
        model: 'nova-2-general', // High-accuracy model optimized for general conversation
        language: 'en', // English language
        smartFormat: true, // Automatic punctuation and formatting
        interimResults: true, // Enable streaming interim results for lower perceived latency
      }),

      // OpenAI GPT-4o mini LLM - processes commands and generates responses
      // Optimized for low latency and cost-effective operation
      // Function calling enables structured CRUD operations
      llm: new openai.LLM({
        model: 'gpt-4o-mini', // Fast, cost-effective model with function calling support
        temperature: 0.7, // Balanced creativity for natural responses
      }),

      // OpenAI TTS - converts agent responses to speech
      // Using streaming mode for low-latency playback
      // tts-1 model provides good quality with low latency
      tts: new openai.TTS({
        model: 'tts-1', // Standard quality, optimized for latency
        voice: 'alloy', // Natural, friendly, gender-neutral voice
        speed: 1.0, // Normal speaking speed
        // Streaming is enabled by default for low-latency playback
      }),

      // VAD and turn detection for natural conversation flow
      turnDetection: new livekit.turnDetector.MultilingualModel(),
    };

    // Add VAD from prewarm
    sessionOptions.vad = ctx.proc.userData.vad;

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

    // Start the session with the task assistant
    await session.start({
      agent: new TaskAssistant(taskFunctionContext, userTimezone),
      room: ctx.room,
      // Note: BackgroundVoiceCancellation disabled due to memory leak
      // The Deepgram STT already has good noise handling
    });

    console.log('Voice agent session started successfully');
    console.log('STT: Deepgram nova-2-general');
    console.log('LLM: OpenAI gpt-4o-mini');
    console.log('TTS: OpenAI tts-1 (alloy voice)');

    // Join the room and connect to the user
    await ctx.connect();
    console.log('Connected to room:', ctx.room.name);
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
