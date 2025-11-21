# Voice Agent - Setup Guide

This guide will help you set up and deploy the LiveKit voice agent for the Voice-First Todo application.

## Prerequisites

- Node.js 22+ installed
- pnpm package manager (`npm install -g pnpm`)
- Accounts for the following services:
  - [LiveKit Cloud](https://cloud.livekit.io) - Voice infrastructure
  - [OpenAI](https://platform.openai.com) - LLM and TTS
  - [Deepgram](https://console.deepgram.com) - Speech-to-text
  - [Railway](https://railway.app) or [Render](https://render.com) - Agent deployment (optional)

## Environment Variables

### Required Environment Variables

Copy `.env.example` to `.env.local` and fill in the following values:

#### LiveKit Configuration

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
```

**How to get these:**
1. Go to [LiveKit Cloud](https://cloud.livekit.io/) and create a new project
2. Navigate to Settings → Keys
3. Create a new API key pair
4. Copy the WebSocket URL as `LIVEKIT_URL`
5. Copy the API Key as `LIVEKIT_API_KEY`
6. Copy the API Secret as `LIVEKIT_API_SECRET`

#### OpenAI Configuration

```bash
OPENAI_API_KEY=sk-your-openai-api-key
```

**How to get this:**
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Click "Create new secret key"
3. Copy the key as `OPENAI_API_KEY`
4. Note: You'll need billing set up for API access

#### Deepgram Configuration

```bash
DEEPGRAM_API_KEY=your-deepgram-api-key
```

**How to get this:**
1. Go to [Deepgram Console](https://console.deepgram.com/)
2. Create a new project or select an existing one
3. Navigate to API Keys
4. Create a new API key
5. Copy the key as `DEEPGRAM_API_KEY`

#### Next.js API Configuration

```bash
API_BASE_URL=https://your-app.vercel.app
```

**Important:** This should point to your deployed Next.js application URL (e.g., `https://voice-todo-app.vercel.app`). For local development, use `http://localhost:3000`.

#### Health Check Configuration (Optional)

```bash
HEALTH_CHECK_PORT=8080
```

This is used by deployment platforms like Railway and Render for health checks. Default is 8080.

## Local Development

### 1. Install dependencies

```bash
pnpm install
```

### 2. Download required models

Before your first run, download the Silero VAD and LiveKit turn detector models:

```bash
pnpm run download-files
```

### 3. Build the project

```bash
pnpm run build
```

### 4. Run the agent

For development with auto-reload:

```bash
pnpm run dev
```

For production mode:

```bash
pnpm run start
```

### 5. Test the agent

The agent will connect to LiveKit and wait for room connections. You can test it by:

1. Opening the Next.js frontend at `http://localhost:3000`
2. Clicking the microphone button
3. Speaking a voice command (e.g., "Create a task to buy groceries")

## Deployment

### Option 1: Deploy to Railway

#### Using Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Add environment variables
railway variables set LIVEKIT_URL=wss://your-project.livekit.cloud
railway variables set LIVEKIT_API_KEY=your-api-key
railway variables set LIVEKIT_API_SECRET=your-api-secret
railway variables set OPENAI_API_KEY=sk-your-key
railway variables set DEEPGRAM_API_KEY=your-key
railway variables set API_BASE_URL=https://your-app.vercel.app

# Deploy
railway up
```

#### Using Railway Dashboard

1. Push your code to GitHub
2. Go to [Railway Dashboard](https://railway.app/new)
3. Click "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect the Dockerfile
6. Add environment variables in the Variables tab:
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `OPENAI_API_KEY`
   - `DEEPGRAM_API_KEY`
   - `API_BASE_URL`
   - `HEALTH_CHECK_PORT` (optional, defaults to 8080)
7. Click "Deploy"

The `railway.json` file is already configured with health check settings.

### Option 2: Deploy to Render

#### Using Render Dashboard

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/select-repo)
3. Click "New +" → "Web Service"
4. Connect your repository
5. Render will automatically detect the Dockerfile
6. Configure the service:
   - **Name**: voice-todo-agent
   - **Region**: Choose closest to your users
   - **Plan**: Starter or higher
7. Add environment variables:
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `OPENAI_API_KEY`
   - `DEEPGRAM_API_KEY`
   - `API_BASE_URL`
   - `HEALTH_CHECK_PORT` (optional, defaults to 8080)
8. Click "Create Web Service"

The `render.yaml` file is already configured with health check settings.

### Option 3: Deploy to LiveKit Cloud

See the [LiveKit Cloud deployment guide](https://docs.livekit.io/agents/ops/deployment/) for deploying agents directly to LiveKit Cloud.

## Health Check Endpoint

The agent includes a health check HTTP server that responds to `GET /health` requests. This is used by deployment platforms to verify the agent is running.

**Health check endpoint:** `http://your-agent-url:8080/health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Monitoring and Debugging

### View Logs

**Railway:**
```bash
railway logs
```

**Render:**
View logs in the Render dashboard under your service → Logs tab

### Monitor Latency

The agent logs detailed latency metrics for each stage of the voice pipeline:

- STT latency (Deepgram)
- LLM latency (OpenAI GPT-4o mini)
- TTS latency (OpenAI TTS)
- Total round-trip time

Look for log entries like:
```
[Latency] Metrics collected: {...}
```

### Test Voice Commands

Example commands to test:

- **Create**: "Create a task to buy groceries"
- **Read**: "Show me all my tasks"
- **Update**: "Reschedule the 4th task to tomorrow"
- **Delete**: "Delete the task about groceries"

## Troubleshooting

### Agent Not Connecting to LiveKit

- Verify your LiveKit URL, API key, and secret are correct
- Check that the LiveKit URL starts with `wss://`
- Ensure your LiveKit project is active

### Voice Commands Not Working

- Check that all API keys (OpenAI, Deepgram) are valid
- Verify the `API_BASE_URL` points to your deployed Next.js app
- Check agent logs for error messages
- Ensure the Next.js app is accessible from the agent

### High Latency

- Check your deployment region (should be close to users)
- Monitor individual stage latencies in logs
- Consider upgrading to a higher-tier deployment plan
- Verify network connectivity between agent and APIs

### Health Check Failing

- Ensure `HEALTH_CHECK_PORT` is set correctly (default: 8080)
- Check that the port is not blocked by firewall
- Verify the health check endpoint is accessible: `curl http://localhost:8080/health`

### Docker Build Issues

- Ensure Docker is installed and running
- Check that all dependencies are in `package.json`
- Verify the Dockerfile is in the root directory
- Try building locally: `docker build -t voice-agent .`

## Performance Optimization

### Reduce Latency

1. **Use streaming**: All services (STT, TTS) are configured for streaming by default
2. **Optimize LLM prompt**: Keep system prompt concise
3. **Use faster models**: GPT-4o mini is already optimized for speed
4. **Deploy close to users**: Choose deployment region wisely

### Reduce Costs

1. **Use efficient models**: GPT-4o mini is 60% cheaper than GPT-4
2. **Monitor usage**: Check OpenAI and Deepgram dashboards
3. **Implement caching**: Cache frequent queries (already implemented in Next.js API)
4. **Set usage limits**: Configure API key limits in provider dashboards

## Next Steps

After deploying the agent:

1. Update the `API_BASE_URL` in the agent environment to point to your deployed Next.js app
2. Test voice commands end-to-end
3. Monitor latency and accuracy metrics
4. Customize the agent's system prompt and behavior
5. Add additional voice commands or features

## Support

For issues or questions:
- Check the [LiveKit Agents documentation](https://docs.livekit.io/agents/)
- Review the [LiveKit Agents Node.js guide](https://docs.livekit.io/agents/quickstart/nodejs/)
- Check the [OpenAI API documentation](https://platform.openai.com/docs)
- Check the [Deepgram documentation](https://developers.deepgram.com/)
