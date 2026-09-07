# Windows Setup Guide for Holstrom Strategy

## ⚠️ Critical Windows Limitation

**Surfpool TypeScript SDK does not support Windows.** The package `@solana/surfpool-win32-x64-msvc` is not available, which means the TypeScript implementation cannot run directly on Windows.

## 🎯 Windows Solutions

### Option 1: WSL2 (Recommended for Windows Users)

Since you're already on Windows, WSL2 is the best solution:

#### Step 1: Install WSL2
```powershell
# Run in PowerShell as Administrator
wsl --install
```

#### Step 2: Set Up Ubuntu Environment
```bash
# After WSL2 installation and restart, open Ubuntu
sudo apt update
sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Install Surfpool
curl -sL https://run.surfpool.run/ | bash
```

#### Step 3: Access Your Project
```bash
# Access Windows files from WSL2
cd /mnt/c/Users/PATIENCE/holstrom-strategy

# Install dependencies
npm install

# Run the strategy
npm run run:strategy
```

### Option 2: Docker (Alternative)

#### Step 1: Install Docker Desktop
Download and install Docker Desktop for Windows from https://www.docker.com/products/docker-desktop

#### Step 2: Create Dockerfile
```dockerfile
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Install Surfpool
RUN curl -sL https://run.surfpool.run/ | bash

# Set working directory
WORKDIR /app

# Copy project files
COPY package*.json ./
RUN npm install

COPY . .

# Expose Surfpool port
EXPOSE 8899

# Run strategy
CMD ["npm", "run", "run:strategy"]
```

#### Step 3: Build and Run
```powershell
# Build Docker image
docker build -t holstrom-strategy .

# Run container
docker run -it holstrom-strategy
```

### Option 3: Remote Development

#### GitHub Codespaces
1. Create a GitHub repository with your project
2. Create a new Codespace
3. Codespaces runs on Linux with full Surfpool support
4. Install dependencies and run strategy directly

#### Remote Linux Server
1. Rent a Linux VPS (DigitalOcean, AWS, etc.)
2. SSH into the server
3. Clone your project
4. Install dependencies and run strategy

## 🔄 Current Windows Workaround

Since you have the Rust implementation working, you can:

### Use Rust Implementation as Base
The Rust simulation (`src/strategy.rs`) is already working on Windows. You can:

1. **Use it as a reference** for understanding the strategy logic
2. **Port the logic** to the TypeScript implementation once you have Linux access
3. **Test mathematical models** using the Rust version

### Run TypeScript on Windows with WSL2
```bash
# From Windows PowerShell
wsl

# From WSL2 Ubuntu
cd /mnt/c/Users/PATIENCE/holstrom-strategy
npm install
npm run run:strategy
```

## 📋 Prerequisites Check

Before proceeding, verify you have:

- [ ] Windows 10/11 with WSL2 support
- [ ] Administrative privileges for WSL2 installation
- [ ] Internet connection for package downloads
- [ ] Basic knowledge of Linux command line

## 🚀 Quick Start with WSL2

```powershell
# In PowerShell (Administrator)
wsl --install -d Ubuntu

# Restart computer when prompted

# After restart, open Ubuntu and run:
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
curl -sL https://run.surfpool.run/ | bash

# Navigate to your project
cd /mnt/c/Users/PATIENCE/holstrom-strategy
npm install
npm run run:strategy
```

## 🔧 Troubleshooting WSL2

### WSL2 Installation Issues
```powershell
# Enable WSL features
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

# Restart computer
wsl --set-default-version 2
```

### Network Issues
```bash
# Fix DNS issues in WSL2
sudo rm /etc/resolv.conf
sudo bash -c 'echo "nameserver 8.8.8.8" > /etc/resolv.conf'
sudo bash -c 'echo "[network]" > /etc/wsl.conf'
sudo bash -c 'echo "generateResolvConf = false" >> /etc/wsl.conf'
```

### Performance Issues
```bash
# Increase WSL2 memory allocation
# Create .wslconfig in Windows user directory
# Content:
[wsl2]
memory=8GB
processors=4
swap=4GB
```

## 📊 What Works on Windows Now

### ✅ Working Components
- Rust simulation (`cargo run`)
- Project structure and documentation
- TypeScript code (but cannot execute on Windows)
- Configuration files

### ❌ Not Working on Windows
- Surfpool TypeScript SDK execution
- Real on-chain integration
- Flash loan integration
- Pool SDK integration

## 🎯 Recommended Path Forward

1. **Install WSL2** (30 minutes setup)
2. **Test Surfpool** in WSL2 environment
3. **Run the strategy** using the TypeScript implementation
4. **Compare results** with your Rust simulation
5. **Debug and optimize** based on real on-chain results

## 📞 Getting Help

If you encounter issues:

1. **WSL2 Issues**: https://github.com/microsoft/WSL
2. **Surfpool Issues**: https://github.com/solana-foundation/surfpool
3. **Strategy Issues**: Check the logs and error messages

---

**Summary**: The real on-chain implementation requires Linux/macOS. Use WSL2 on Windows to run the TypeScript implementation, or continue using the Rust simulation for development and testing.