#!/bin/bash
# Exit on any error
set -e

echo "===================================================="
echo "🚀 Deploying Dista Internal Tools to Firebase Hosting"
echo "===================================================="

# 1. Authenticate with Firebase
echo "🔑 Step 1: Authenticating with Firebase CLI..."
npx -y firebase-tools@latest login

# 2. Deploy to Firebase Hosting
echo ""
echo "📤 Step 2: Deploying static files to dista-tools..."
npx -y firebase-tools@latest deploy --only hosting --project dista-tools

echo ""
echo "🎉 DEPLOYMENT COMPLETE!"
echo "Your app is now live at: https://dista-tools.web.app"
echo "===================================================="
