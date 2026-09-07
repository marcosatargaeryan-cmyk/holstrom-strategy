FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
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

# Copy package files
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Expose Surfpool port
EXPOSE 8899

# Default command
CMD ["bash", "-c", "surfpool start --network mainnet-beta --clone 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6 --clone Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE && npm run run:strategy"]