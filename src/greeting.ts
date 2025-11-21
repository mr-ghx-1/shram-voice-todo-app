import type { JobContext } from '@livekit/agents';
import type { voice } from '@livekit/agents';

/**
 * Configuration for the agent greeting message
 */
interface GreetingConfig {
  message: string;
  playOnce: boolean;
}

/**
 * Greeting configuration
 * The agent will say this message when first connecting to a room
 */
export const GREETING_CONFIG: GreetingConfig = {
  message: "Hi, I'm Sid, how can I assist you today?",
  playOnce: true,
};

/**
 * Play greeting message when agent connects to room
 * Uses room metadata to track whether greeting has been played
 * 
 * This function should be called after the voice session has started
 * so that the TTS pipeline is available.
 * 
 * @param ctx - Job context containing room information
 * @param session - Voice agent session with TTS capabilities
 */
export async function playGreeting(
  ctx: JobContext,
  session: voice.AgentSession
): Promise<void> {
  try {
    console.log('Checking if greeting should be played...');
    
    // Check if greeting has already been played for this room
    const roomMetadata = ctx.room.metadata;
    let greetingPlayed = false;
    
    if (roomMetadata) {
      try {
        const metadata = JSON.parse(roomMetadata);
        greetingPlayed = metadata.greetingPlayed === true;
      } catch (err) {
        console.warn('Failed to parse room metadata:', err);
      }
    }
    
    if (greetingPlayed) {
      console.log('Greeting already played for this room, skipping');
      return;
    }
    
    console.log('Playing greeting message:', GREETING_CONFIG.message);
    
    // Use the session to say the greeting
    // The session handles all the TTS and audio publishing
    await session.say(GREETING_CONFIG.message, { allowInterruptions: false });
    
    console.log('Greeting playback complete');
    
    // Mark greeting as played by storing in a module-level variable
    // (Room metadata updates are not straightforward in LiveKit)
    if (ctx.room.name) {
      greetingPlayedRooms.add(ctx.room.name);
    }
    
  } catch (error) {
    console.error('Failed to play greeting:', error);
    // Non-critical error - continue without greeting
  }
}

/**
 * Track which rooms have had greetings played
 * This is a simple in-memory solution since room metadata updates
 * are complex in the LiveKit framework
 */
const greetingPlayedRooms = new Set<string>();

/**
 * Check if greeting has been played for a room
 */
export function hasGreetingBeenPlayed(roomName: string): boolean {
  return greetingPlayedRooms.has(roomName);
}
