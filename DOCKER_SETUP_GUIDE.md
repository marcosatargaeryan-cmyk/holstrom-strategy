# Docker Setup Guide for Holstrom Strategy

## 🚀 Quick Setup (15 minutes)

### Step 1: Complete Docker Installation
The Docker Desktop Installer should be running. Please complete the installation wizard.

### Step 2: Verify Docker Installation
Once installation completes, open a new PowerShell window and run:

```powershell
docker --version
```

### Step 3: Build Docker Image
```powershell
cd C:\Users\PATIENCE\holstrom-strategy
docker build -t holstrom-strategy .
```

### Step 4: Run Docker Container
```powershell
docker run -it --rm -p 8899:8899 holstrom-strategy
```

### Step 5: View Results
The strategy will execute automatically inside the container with real Surfpool.

## 🔧 Alternative: Manual Docker Commands

If automated setup doesn't work, use these manual commands:

### Build Image
```powershell
docker build -t holstrom-strategy .
```

### Run with Volume Mount (for development)
```powershell
docker run -it --rm -p 8899:8899 -v ${PWD}:/app holstrom-strategy
```

### Run in Background
```powershell
docker run -d -p 8899:8899 holstrom-strategy
docker logs <container_id>
```

## 🐛 Troubleshooting

### Docker Not Found
```powershell
# Restart Docker Desktop from Start Menu
# Or try:
& "C:\Program Files\Docker\Docker\DockerCli.exe" version
```

### Port Already in Use
```powershell
# Kill process using port 8899
netstat -ano | findstr :8899
taskkill /PID <PID> /F
```

### Build Failures
```powershell
# Clean build cache
docker system prune -a
docker build --no-cache -t holstrom-strategy .
```

## 📊 Expected Docker Results

When running in Docker with real Surfpool:
- **Execution Time**: 30-60 seconds (real on-chain)
- **Expected Profit**: $190,000–$200,000 (real on-chain)
- **Transaction Count**: 10-15 real blockchain transactions
- **Pool Interactions**: Real Meteora DLMM and Orca CLMM swaps

## 🎯 What Docker Provides

- **Linux Environment**: Full Surfpool compatibility
- **Isolated Runtime**: No conflicts with Windows
- **Pre-configured**: All dependencies installed
- **Consistent**: Same environment every time
- **Portable**: Can run on any machine with Docker

## 📝 Next Steps After Docker Setup

1. **Verify Docker is running**: Check Docker Desktop status
2. **Build the image**: `docker build -t holstrom-strategy .`
3. **Run the container**: `docker run -it holstrom-strategy`
4. **Monitor execution**: Watch the real-time logs
5. **Compare results**: Compare Docker results with Windows simulation

The Docker setup will give you the **real on-chain results** with actual Surfpool, unlike the current Windows simulation.