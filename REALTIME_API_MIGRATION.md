# OpenAI Realtime API Migration

## Overview

This document describes the migration from Deepgram STT + OpenAI LLM + OpenAI TTS to the OpenAI Realtime API.

## Changes Made

### 1. Removed Dependencies
- **Deepgram plugin**: No longer needed for STT
- **Silero VAD**: Realtime API has built-in VAD
- **LiveKit turn detector**: Realtime API handles turn detection

### 2. Updated Agent Configuration

**Before (Separate Pipeline):**
```typescript
stt: new deepgram.STT({ model: 'nova-2-general' }),
llm: new openai.LLM({ model: 'gpt-4o-mini' }),
tts: new openai.TTS({ model: 'tts-1', voice: 'alloy' }),
vad: silero.VAD,
turnDetection: livekit.turnDetector.MultilingualModel()
```

**After (Realtime API):**
```typescript
llm: new openai.realtime.RealtimeModel({
  model: 'gpt-realtime-mini',
  voice: 'alloy',
  temperature: 0.7,
  turnDetection: {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    create_response: true,
    interrupt_response: true,
  },
})
```

## Cost Comparison

### Current Setup (Deepgram + OpenAI)
**Per minute of conversation:**
- STT (Deepgram Nova-2): $0.0077/min
- LLM (GPT-4o-mini): ~$0.0015/min
- TTS (OpenAI tts-1): ~$0.0024/min
- **Total: ~$0.0116/min (~$0.70/hour)**

### OpenAI Realtime API
**Per minute of conversation:**
- gpt-realtime-mini (all-in-one): ~$0.024-0.036/min
- **Total: ~$0.024-0.036/min (~$1.44-2.16/hour)**

### Cost Impact
- **2-3x more expensive** than the current setup
- Estimated increase: **$0.74-1.46/hour** of conversation

### Monthly Cost Estimates (based on usage)
- **10 hours/month**: $7-14 → $14-22 (+$7-8/month)
- **50 hours/month**: $35-70 → $72-108 (+$37-38/month)
- **100 hours/month**: $70-140 → $144-216 (+$74-76/month)

## Benefits of Realtime API

### 1. Lower Latency
- **Speech-to-speech processing**: No separate STT/TTS pipeline
- **Reduced round-trip time**: Single WebSocket connection
- **Faster response times**: Typically 200-400ms faster

### 2. Better User Experience
- **Improved interruption handling**: Built-in context truncation
- **Synchronized transcription**: Text output synced to audio playback
- **Natural conversation flow**: Better turn detection

### 3. Simpler Architecture
- **One API instead of three**: Easier to maintain
- **Fewer dependencies**: Less code to manage
- **Built-in VAD**: No need for separate voice activity detection

### 4. Advanced Features
- **Semantic VAD option**: Can detect when user is done speaking based on words
- **Multiple voice options**: Same voices as TTS API
- **Multimodal support**: Can handle text, audio, and (future) video

## Configuration Options

### Voice Options
Available voices (same as OpenAI TTS):
- `alloy` (default) - Neutral, friendly
- `echo` - Male, clear
- `fable` - British accent
- `onyx` - Deep, authoritative
- `nova` - Energetic, young
- `shimmer` - Warm, upbeat

### Model Options
- `gpt-realtime-mini` (recommended) - Cost-effective, fast
- `gpt-realtime` - Higher quality, more expensive

### VAD Configuration
**Server VAD (default):**
- `threshold`: 0.5 (0.0-1.0, higher = less sensitive to noise)
- `prefix_padding_ms`: 300 (audio before speech starts)
- `silence_duration_ms`: 500 (silence to detect speech end)

**Semantic VAD (alternative):**
```typescript
turnDetection: {
  type: 'semantic_vad',
  eagerness: 'auto', // 'low', 'medium', 'high', 'auto'
  create_response: true,
  interrupt_response: true,
}
```

## Environment Variables

No changes needed! The same `OPENAI_API_KEY` is used for both the old and new setup.

**Required:**
- `OPENAI_API_KEY` - Your OpenAI API key
- `LIVEKIT_URL` - LiveKit server URL
- `LIVEKIT_API_KEY` - LiveKit API key
- `LIVEKIT_API_SECRET` - LiveKit API secret

**Optional:**
- `DEEPGRAM_API_KEY` - No longer needed (can be removed)

## Deployment

The changes are backward compatible with your existing deployment:

1. Build: `npm run build`
2. Deploy to Railway: `railway up` or push to GitHub (auto-deploy)
3. No environment variable changes needed

## Monitoring

Watch for these metrics in your logs:
- Response latency (should be lower)
- Token usage (will be higher)
- Interruption handling (should be smoother)
- Turn detection accuracy (should be better)

## Rollback Plan

If you need to rollback to the previous setup:

1. Restore the old imports:
```typescript
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as silero from '@livekit/agents-plugin-silero';
import * as livekit from '@livekit/agents-plugin-livekit';
```

2. Restore the old session configuration (see git history)

3. Rebuild and redeploy

## Recommendations

### When to Use Realtime API
- ✅ Low-latency requirements (< 500ms response time)
- ✅ Natural conversation flow is critical
- ✅ Budget allows for 2-3x cost increase
- ✅ Simpler architecture is preferred

### When to Keep Separate Pipeline
- ✅ Cost is a primary concern
- ✅ Current latency is acceptable
- ✅ Need specific STT/TTS providers
- ✅ Want more control over each component

## Next Steps

1. **Test the new setup** with real users
2. **Monitor costs** in OpenAI dashboard
3. **Adjust VAD settings** if needed for your use case
4. **Consider voice options** to match your brand
5. **Evaluate cost vs. benefit** after 1-2 weeks

## Support

- OpenAI Realtime API docs: https://platform.openai.com/docs/guides/realtime
- LiveKit Agents docs: https://docs.livekit.io/agents/models/realtime/plugins/openai
- OpenAI pricing: https://openai.com/api/pricing/
