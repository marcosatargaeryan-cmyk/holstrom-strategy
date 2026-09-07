# GitHub Codespaces Setup for Holstrom Strategy

Since Windows has limitations with Surfpool, GitHub Codespaces is the easiest solution - it provides a free Linux environment in the cloud.

## 🚀 Quick Setup (5 minutes)

### Step 1: Push to GitHub

```bash
# Initialize git if not already done
cd holstrom-strategy
git init
git add .
git commit -m "Initial commit - Holstrom strategy implementation"

# Create a new repository on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/holstrom-strategy.git
git branch -M main
git push -u origin main
```

### Step 2: Create Codespace

1. Go to your repository on GitHub
2. Click the green "Code" button
3. Select "Codespaces" tab
4. Click "Create codespace on main"
5. Wait for the environment to build (2-3 minutes)

### Step 3: Install Dependencies in Codespace

```bash
# The Codespace comes with Node.js pre-installed
npm install

# Install Surfpool
curl -sL https://run.surfpool.run/ | bash
```

### Step 4: Run the Strategy

```bash
# Start Surfpool
surfpool start \
  --network mainnet-beta \
  --clone 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6 \
  --clone Czfq3xZZDmsdGdsUyrNLtRhGc47cXcZtLG4crryfu44zE \
  --clone So11111111111111111111111111111111111111112 \
  --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# In another terminal (Codespaces supports multiple terminals)
npm run run:strategy
```

## 🎯 Benefits of GitHub Codespaces

- ✅ **Free for personal use** (up to 60 hours/month)
- ✅ **Full Linux environment** with Surfpool support
- ✅ **Pre-installed tools** (Node.js, Git, VS Code)
- ✅ **No local setup required**
- ✅ **Accessible from anywhere**
- ✅ **Persistent storage** for your work

## 📋 Alternative: Use Existing Cloud Provider

If you prefer not to use GitHub Codespaces:

### DigitalOcean Droplet
```bash
# Create a $4/month Ubuntu droplet
# SSH into it
ssh root@your_droplet_ip

# Install dependencies
apt update
apt install -y nodejs npm curl git
curl -sL https://run.surfpool.run/ | bash

# Clone your repo
git clone https://github.com/YOUR_USERNAME/holstrom-strategy.git
cd holstrom-strategy
npm install

# Run strategy
surfpool start --network mainnet-beta --clone 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6 --clone Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
npm run run:strategy
```

### AWS Free Tier
Similar setup using AWS EC2 free tier (750 hours/month).

## 🔧 Quick Test Without Full Setup

Let me first check if the TypeScript code has any syntax errors: