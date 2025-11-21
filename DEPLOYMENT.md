# Voice Agent Deployment Guide

This guide explains how to deploy the LiveKit voice agent to production.

## Prerequisites

- Docker installed (for local testing)
- Account on Railway.app or Render.com
- All API keys configured (LiveKit, OpenAI, Deepgram)
- Next.js app deployed to Vercel

## Deployment Options

### Option 1: Railway (Recommended)

Railway provides automatic deployments from GitHub with Docker support.

#### Steps:

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your agent repository

3. **Configure Environment Variables**
   
   Add the following variables in Railway dashboard:
   
   ```
   LIVEKIT_URL=wss://shram-sz7glw0y.livekit.cloud
   LIVEKIT_API_KEY=APIMHZhz9AaSWLZ
   LIVEKIT_API_SECRET=ODwNRboFSsRvR5We4Ri8klrifOxObeApHxFtilIAtB4A
   OPENAI_API_KEY=sk-proj-...
   DEEPGRAM_API_KEY=f0c290549af7686c5aef72966af5dc8a9df9df2e
   API_BASE_URL=https://voice-todo-app-two.vercel.app
   HEALTH_CHECK_PORT=8080
   NODE_ENV=production
   ```

4. **Deploy**
   - Railway will automatically detect the Dockerfile
   - Build and deployment will start automatically
   - Wait for deployment to complete

5. **Verify Deployment**
   - Check the health endpoint: `https://your-app.railway.app/health`
   - Should return: `{"status":"ok","timestamp":"..."}`

### Option 2: Render

Render provides similar functionality with a free tier.

#### Steps:

1. **Create Render Account**
   - Go to [render.com](https://render.com)
   - Sign up with GitHub

2. **Create New Web Service**
   - Click "New +"
   - Select "Web Service"
   - Connect your GitHub repository

3. **Configure Service**
   - Name: `voice-todo-agent`
   - Region: Oregon (or closest to your users)
   - Branch: `main`
   - Runtime: Docker
   - Dockerfile Path: `./Dockerfile`

4. **Add Environment Variables**
   
   Use the same variables as Railway (see above)

5. **Deploy**
   - Click "Create Web Service"
   - Wait for build and deployment

6. **Verify Deployment**
   - Check health endpoint: `https://voice-todo-agent.onrender.com/health`

## Local Testing with Docker

Before deploying, test the Docker build locally:

```bash
# Build the image
docker build -t voice-agent .

# Run the container
docker run -p 8080:8080 \
  -e LIVEKIT_URL=wss://shram-sz7glw0y.livekit.cloud \
  -e LIVEKIT_API_KEY=APIMHZhz9AaSWLZ \
  -e LIVEKIT_API_SECRET=ODwNRboFSsRvR5We4Ri8klrifOxObeApHxFtilIAtB4A \
  -e OPENAI_API_KEY=sk-proj-... \
  -e DEEPGRAM_API_KEY=f0c290549af7686c5aef72966af5dc8a9df9df2e \
  -e API_BASE_URL=https://voice-todo-app-two.vercel.app \
  -e HEALTH_CHECK_PORT=8080 \
  voice-agent

# Test health endpoint
curl http://localhost:8080/health
```

## Monitoring

### Health Checks

The agent exposes a health check endpoint at `/health`:

```bash
curl https://your-agent-url/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-01-21T12:00:00.000Z"
}
```

### Logs

**Railway:**
- View logs in the Railway dashboard
- Click on your service → "Logs" tab

**Render:**
- View logs in the Render dashboard
- Click on your service → "Logs" tab

### Common Issues

#### Agent not connecting to LiveKit

**Symptoms:**
- Health check passes but no voice commands work
- Logs show connection errors

**Solutions:**
- Verify LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET are correct
- Check LiveKit dashboard for connection attempts
- Ensure WebSocket connections are allowed

#### API calls failing

**Symptoms:**
- Voice commands recognized but tasks not created/updated
- Logs show 404 or 500 errors

**Solutions:**
- Verify API_BASE_URL points to deployed Vercel app
- Check Vercel deployment is live
- Test API endpoints directly: `curl https://voice-todo-app-two.vercel.app/api/tasks`

#### High latency

**Symptoms:**
- Voice commands take >2 seconds
- Slow responses

**Solutions:**
- Deploy agent in same region as LiveKit server
- Check OpenAI API latency
- Review Deepgram API performance
- Optimize API_BASE_URL endpoint performance

## Scaling

### Railway

- Automatic scaling based on load
- Configure in "Settings" → "Scaling"
- Set min/max instances

### Render

- Manual scaling in dashboard
- Upgrade to paid plan for auto-scaling
- Configure in "Settings" → "Scaling"

## Cost Estimates

### Railway
- Free tier: $5 credit/month
- Estimated cost: $5-10/month for light usage
- Pay-as-you-go after free tier

### Render
- Free tier: 750 hours/month
- Estimated cost: Free for development, $7/month for production

### API Costs
- OpenAI: ~$0.50-2.00 per 1000 voice commands
- Deepgram: ~$0.30-1.00 per 1000 voice commands
- LiveKit: Free tier available, then pay-as-you-go

## Security

### Environment Variables

- Never commit `.env.local` or `.env.production` to git
- Use platform-specific secret management
- Rotate API keys regularly

### Network Security

- Agent only needs outbound connections
- No inbound connections except health check
- Use HTTPS for all API calls

## Rollback

If deployment fails:

1. **Railway:**
   - Go to "Deployments" tab
   - Click on previous successful deployment
   - Click "Redeploy"

2. **Render:**
   - Go to "Events" tab
   - Find previous successful deployment
   - Click "Rollback"

## Support

- **Railway:** https://railway.app/help
- **Render:** https://render.com/docs
- **LiveKit:** https://livekit.io/support
- **OpenAI:** https://platform.openai.com/docs
- **Deepgram:** https://developers.deepgram.com/

## Next Steps

After deployment:

1. Test voice commands end-to-end
2. Monitor logs for errors
3. Set up uptime monitoring (UptimeRobot, Pingdom)
4. Configure alerts for failures
5. Document any custom configuration

## Deployment Checklist

- [ ] All environment variables configured
- [ ] Docker build succeeds locally
- [ ] Health check endpoint responds
- [ ] Agent connects to LiveKit
- [ ] Voice commands work end-to-end
- [ ] API calls succeed
- [ ] Logs show no errors
- [ ] Monitoring configured
- [ ] Documentation updated

## Status

**Current Deployment Status:** Ready for deployment

**Recommended Platform:** Railway (easier setup, better developer experience)

**Estimated Setup Time:** 15-20 minutes
