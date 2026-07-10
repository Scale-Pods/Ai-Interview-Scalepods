# AI Interviewer Platform - Setup Guide

Comprehensive setup and configuration guide for the AI Interviewer Platform.

## 🎯 Overview

This document provides step-by-step instructions for setting up the AI Interviewer Platform from scratch, including database configuration, environment setup, and deployment instructions.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Supabase Configuration](#supabase-configuration)
4. [Environment Configuration](#environment-configuration)
5. [Database Setup](#database-setup)
6. [Running the Application](#running-the-application)
7. [Testing Voice Features](#testing-voice-features)
8. [Troubleshooting](#troubleshooting)
9. [Deployment Guide](#deployment-guide)
10. [Maintenance Tasks](#maintenance-tasks)

## 1. Prerequisites

### Software Requirements
- **Node.js**: Version 18.0.0 or higher
  - Download: https://nodejs.org/
  - Verify: `node --version` (should show v18.x or higher)
- **Package Manager**: npm (comes with Node.js) or Yarn
- **Git**: For version control (optional but recommended)
- **Web Browser**: Chrome, Firefox, Safari, or Edge (Chrome recommended for best Web Speech API support)

### Hardware Requirements
- **Minimum**: 4GB RAM, dual-core processor
- **Recommended**: 8GB RAM, quad-core processor
- **Storage**: 5GB available space
- **Audio**: Microphone and speakers/headset (for voice features)

## 2. Initial Setup

### Clone Repository
```bash
# Using HTTPS
git clone https://github.com/your-username/ai-interviewer.git
cd ai-interviewer

# Using SSH (if you have SSH key set up)
git clone git@github.com:your-username/ai-interviewer.git
cd ai-interviewer
```

### Install Dependencies
```bash
npm install
```

This will install all dependencies listed in package.json including:
- React 18 + TypeScript
- Vite (build tool)
- Supabase JS client
- Tailwind CSS
- Lucide React (icons)
- Recharts (charts)
- React Router v6

## 3. Supabase Configuration

### Create Supabase Project
1. Go to https://supabase.com and sign up/sign in
2. Click "New Project"
3. Fill in project details:
   - Organization: Your organization
   - Project Name: ai-interviewer (or your choice)
   - Database Password: Strong password (save this!)
   - Region: Choose closest to your users
4. Click "Create new project"

### Get API Keys
1. In your Supabase dashboard, go to Settings → API
2. Copy:
   - **Project URL**: Found under "Project URL"
   - **anon public key**: Found under "Project API keys" → anon public

### Enable Required Extensions
In your Supabase dashboard:
1. Go to Database → Extensions
2. Enable these extensions (if not already enabled):
   - `uuid-ossp` (for UUID generation)
   - `btree_gin` (for JSONB indexing)
   - `pgcrypto` (for cryptographic functions)

## 4. Environment Configuration

### Create Environment File
```bash
cp .env.example .env
```

### Configure .env File
Edit `.env` with your Supabase credentials:

```env
# Required - Supabase Connection
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key-here

# Optional - API Configuration (usually fine as defaults)
VITE_API_BASE=/api/v1
VITE_WEBHOOK_SCORING_PIPELINE=/webhook/score-interview
VITE_WEBHOOK_PROCTORING_EVENT=/webhook/proctoring-event

# Optional - Feature Flags
VITE_ENABLE_VOICE=true
VITE_LOG_LEVEL=info
```

### Verify Environment Variables
Your `.env` file should look like:
```env
VITE_SUPABASE_URL=https://abc123.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_API_BASE=/api/v1
VITE_WEBHOOK_SCORING_PIPELINE=/webhook/score-interview
VITE_WEBHOOK_PROCTORING_EVENT=/webhook/proctoring-event
VITE_ENABLE_VOICE=true
```

## 5. Database Setup

### Run SQL Migrations
You need to create the database schema and set up Row Level Security (RLS) policies.

#### Option 1: Using Supabase Dashboard (Recommended for Beginners)
1. Go to your Supabase project dashboard
2. Click "SQL Editor" in the left sidebar
3. Click "New query"
4. Copy and paste the SQL from [DATABASE_SETUP.sql](#database-setup-sql) below
5. Click "RUN"

#### Option 2: Using Supabase CLI
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Start local development (optional)
supabase start

# Apply migrations
supabase db push
```

### DATABASE_SETUP.sql

```sql
-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable btree_gin for JSONB operations
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Enable pgcrypto for cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create interview_sessions table
CREATE TABLE IF NOT EXISTS interview_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'invited', 'in_progress', 'completed', 'cancelled', 'expired')),
    invite_link TEXT,
    token_hash TEXT UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME Z NULL,
    completed_at TIMESTAMP WITH TIME Z NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create candidates table
CREATE TABLE IF NOT EXISTS candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    job_description TEXT,
    resume_text TEXT,
    phone TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create scorecards table
CREATE TABLE IF NOT EXISTS scorecards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES interview_sessions(id) ON DELETE CASCADE,
    technical_score INTEGER CHECK (technical_score BETWEEN 0 AND 100),
    communication_score INTEGER CHECK (communication_score BETWEEN 0 AND 100),
    problem_solving_score INTEGER CHECK (problem_solving_score BETWEEN 0 AND 100),
    cultural_fit_score INTEGER CHECK (cultural_fit_score BETWEEN 0 AND 100),
    overall_score INTEGER CHECK (overall_score BETWEEN 0 AND 100),
    recommendation TEXT NOT NULL CHECK (recommendation IN ('strong_hire', 'hire', 'consider', 'no_go')),
    strengths TEXT[] DEFAULT '{}',
    weaknesses TEXT[] DEFAULT '{}',
    ai_rationale TEXT,
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_by_human BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES interview_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_interview_sessions_status ON interview_sessions(status);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_created_at ON interview_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scorecards_session_id ON scorecards(session_id);
CREATE INDEX IF NOT EXISTS idx_scorecards_overall_score ON scorecards(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_session_id ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- interview_sessions policies
DROP POLICY IF EXISTS hr_select_sessions ON interview_sessions;
CREATE POLICY hr_select_sessions ON interview_sessions FOR SELECT
  USING (auth.role() IN ('authenticated', 'anon'));

DROP POLICY IF EXISTS hr_insert_sessions ON interview_sessions;
CREATE POLICY hr_insert_sessions ON interview_sessions FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS hr_update_sessions ON interview_sessions;
CREATE POLICY hr_update_sessions ON interview_sessions FOR UPDATE
  USING (auth.role() IN ('authenticated', 'anon'));

DROP POLICY IF EXISTS hr_delete_sessions ON interview_sessions;
CREATE POLICY hr_delete_sessions ON interview_sessions FOR DELETE
  USING (auth.role() = 'authenticated');

-- candidates policies
DROP POLICY IF EXISTS hr_select_candidates ON candidates;
CREATE POLICY hr_select_candidates ON candidates FOR SELECT
  USING (auth.role() IN ('authenticated', 'anon'));

DROP POLICY IF EXISTS hr_insert_candidates ON candidates;
CREATE POLICY hr_insert_candidates ON candidates FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS hr_update_candidates ON candidates;
CREATE POLICY hr_update_candidates ON candidates FOR UPDATE
  USING (auth.role() IN ('authenticated', 'anon'));

DROP POLICY IF EXISTS hr_delete_candidates ON candidates;
CREATE POLICY hr_delete_candidates ON candidates FOR DELETE
  USING (auth.role() = 'authenticated');

-- scorecards policies
DROP POLICY IF EXISTS hr_select_scorecards ON scorecards;
CREATE POLICY hr_select_scorecards ON scorecards FOR SELECT
  USING (auth.role() IN ('authenticated', 'anon'));

DROP POLICY IF EXISTS hr_insert_scorecards ON scorecards;
CREATE POLICY hr_insert_scorecards ON scorecards FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS hr_update_scorecards ON scorecards;
CREATE POLICY hr_update_scorecards ON scorecards FOR UPDATE
  USING (auth.role() IN ('authenticated', 'anon'));

DROP POLICY IF EXISTS hr_delete_scorecards ON scorecards;
CREATE POLICY hr_delete_scorecards ON scorecards FOR DELETE
  USING (auth.role() = 'authenticated');

-- interview_questions policies
DROP POLICY IF EXISTS hr_select_questions ON interview_questions;
CREATE POLICY hr_select_questions ON interview_questions FOR SELECT
  USING (auth.role() IN ('authenticated', 'anon'));

-- audit_log policies
DROP POLICY IF EXISTS hr_select_audit_log ON audit_log;
CREATE POLICY hr_select_audit_log ON audit_log FOR SELECT
  USING (auth.role() IN ('authenticated', 'anon'));

DROP POLICY IF EXISTS hr_insert_audit_log ON audit_log;
CREATE POLICY hr_insert_audit_log ON audit_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Enable real-time replication for Supabase Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE interview_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE candidates;
ALTER PUBLICATION supabase_realtime ADD TABLE scorecards;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_log;
```

## 6. Running the Application

### Development Mode
```bash
# Start the development server
npm run dev

# Output should show:
#   VITE v5.0.0  ready in 1234 ms
#   ➜  Local:   http://localhost:5173/
#   ➜  Network: use --host to expose
#   ➜  press h + enter to show help
```

### Production Build
```bash
# Create optimized production build
npm run build

# Preview production build locally
npm run preview
```

## 7. Testing Voice Features

### Browser Requirements
- **Chrome**: Best support for Web Speech API
- **Firefox**: Partial support (speech recognition may require enabling flags)
- **Safari**: Limited support (speech synthesis works, speech recognition may not)
- **Edge**: Good support (based on Chromium)

### Testing Speech-to-Text
1. Start an interview session as a candidate
2. When answering a question, click the microphone button
3. Speak clearly into your microphone
4. Watch as your speech is transcribed in real-time
5. Stop recording when finished
6. Your transcribed text should appear in the answer field

### Testing Text-to-Speech
1. View any question during an interview
2. Click the speaker icon (🔊) next to the question text
3. You should hear the question read aloud
4. Click again to stop/replay

### Troubleshooting Voice Issues
- **Microphone not working**: Check browser permissions for microphone access
- **No speech output**: Check speaker/volume settings and browser permissions for audio playback
- **Speech recognition not available**: Ensure you're using a supported browser (Chrome works best)
- **Language issues**: The API uses the browser's default language setting

## 8. Testing the Full Flow

### HR Workflow
1. Register/login as HR user (admin@test.com / Admin@123)
2. Create a new candidate via "Candidates" → "New Candidate"
3. Create a session for that candidate via "Sessions" → "New Session"
4. Copy the invite link and share with candidate
5. Monitor progress in dashboard

### Candidate Workflow
1. Click the invite link sent by HR
2. Complete Pre-Check (camera and screen sharing)
3. Begin interview when ready
4. Answer questions using text or voice
5. Complete interview and see thank-you screen

### Admin Workflow
1. Login as HR user
2. View dashboard metrics
3. Check individual candidate scores
4. Review AI-generated rationales
5. Mark scorecards as reviewed
6. Export or share results as needed

## 9. Troubleshooting

### Common Issues and Solutions

#### "Failed to load session" error
- **Cause**: Supabase client not initialized properly
- **Solution**: 
  1. Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are correct in .env
  2. Verify Supabase project is active
  3. Clear browser cache and hard refresh (Ctrl+F5)

#### "Questions not loading" error
- **Cause**: Database connection or RLS policy issue
- **Solution**:
  1. Verify database tables exist and have data
  2. Check RLS policies allow SELECT for authenticated users
  3. Check browser console for specific error messages
  4. Test API directly using Supabase SQL editor

#### Voice features not working
- **Cause**: Browser restrictions or missing permissions
- **Solution**:
  1. Ensure you're using HTTPS or localhost (required for Web Speech API)
  2. Check browser permissions for microphone and audio playback
  3. Try Chrome browser for best compatibility
  4. Check console for specific Web Speech API errors

#### "Cannot read property 'name' of undefined" error
- **Cause**: Data mismatch between frontend and database
- **Solution**:
  1. Run database migrations to ensure schema matches
  2. Verify candidate_id is properly set in interview_sessions
  3. Check that candidate data exists for referenced candidate_id

### Checking Logs
- **Browser Console**: Press F12 → Console tab
- **Network Tab**: Press F12 → Network tab (to see API calls)
- **Application Tab**: Press F12 → Application tab → Local Storage (to see stored tokens)

## 10. Deployment Guide

### Vercel Deployment
1. Install Vercel CLI: `npm i -g vercel`
2. Login: `vercel login`
3. Deploy: `vercel`
4. Set environment variables in Vercel dashboard:
   - VITE_SUPABASE_URL
   - VITE_SUPABASE_ANON_KEY
   - VITE_WEBHOOK_SCORING_PIPELINE
   - VITE_WEBHOOK_PROCTORING_EVENT
   - VITE_ENABLE_VOICE

### Netlify Deployment
1. Install Netlify CLI: `npm i -g netlify-cli`
2. Login: `netlify login`
3. Link site: `netlify link`
4. Deploy: `netlify build && netlify deploy --prod`
5. Set environment variables in Netlify dashboard under Site Settings → Build & Deploy → Environment

### Docker Deployment (Optional)
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 5173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
```

Build and run:
```bash
docker build -t ai-interviewer .
docker run -p 5173:5173 --env-file .env ai-interviewer
```

## 11. Maintenance Tasks

### Regular Tasks
- **Backup Database**: Schedule regular backups of your Supabase project
- **Update Dependencies**: `npm update` monthly
- **Check Logs**: Monitor browser console for errors during testing
- **Backup Environment**: Keep your .env file secure and backed up

### Periodic Tasks
- **Review Audit Log**: Check for suspicious activity
- **Optimize Database**: Consider adding additional indexes based on query patterns
- **Update Dependencies**: Check for security updates
- **Test Backups**: Verify you can restore from backups

### Scaling Considerations
- **Supabase**: Upgrade plan as needed for more projects/storage
- **Storage**: Consider external storage for large media files
- **CDN**: Use Vercel/Netlify CDN for static assets
- **Caching**: Implement caching for frequently accessed data

## 12. Getting Help

### Official Documentation
- [Supabase Documentation](https://supabase.com/docs)
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Tailwind CSS Documentation](https://tailwindcss.com)

### Community Support
- Supabase Discord: https://supabase.com/discord
- Reactiflux Discord: https://www.reactiflux.com
- Stack Overflow: Tag with [supabase] and [react]

### Reporting Issues
If you encounter issues:
1. Check the troubleshooting section above
2. Look for existing issues in the repository
3. Create a new issue with:
   - Detailed description
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser/OS information
   - Screenshots or error logs if applicable

## 13. License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**Last Updated**: $(date)
**Version**: 1.0.0
**Maintainer**: AI Interviewer Team