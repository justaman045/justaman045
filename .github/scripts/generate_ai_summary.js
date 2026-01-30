const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const GITHUB_USERNAME = 'justaman045';
const RSS_URLS = [
    'https://coderaman7.hashnode.dev/rss.xml',
    'https://dev.to/feed/justaman045'
];
const GEMINI_MODEL = 'gemini-2.5-flash'; // User requested model
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Helper to fetch data
const fetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                json: () => JSON.parse(data),
                text: () => data
            }));
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
};

async function getRecentGithubActivity(token) {
    const headers = { 'User-Agent': 'node.js' };
    if (token) headers['Authorization'] = `token ${token}`;

    // Fetch events (Using /events instead of /events/public to include private repos if token has scope)
    const response = await fetch(`https://api.github.com/users/${GITHUB_USERNAME}/events`, { headers });
    if (!response.ok) return [];

    const events = await response.json();
    return events.slice(0, 30).map(e => {
        if (e.type === 'PushEvent') {
            const commits = e.payload.commits || [];
            return `Pushed ${e.payload.size} commits to ${e.repo.name}: ${commits.map(c => c.message).join(', ')}`;
        }
        if (e.type === 'CreateEvent') return `Created ${e.payload.ref_type} in ${e.repo.name}`;
        return `${e.type} on ${e.repo.name}`;
    });
}

// Simple RSS parser (regex based for zero-dependency)
async function getRecentBlogPosts() {
    const posts = [];
    for (const url of RSS_URLS) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const xml = await response.text();

            // Extract items
            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let match;
            while ((match = itemRegex.exec(xml)) !== null) {
                const item = match[1];
                const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
                const linkMatch = item.match(/<link>(.*?)<\/link>/);
                const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

                if (titleMatch && linkMatch) {
                    posts.push({
                        title: titleMatch[1],
                        link: linkMatch[1],
                        date: pubDateMatch ? new Date(pubDateMatch[1]) : new Date()
                    });
                }
            }
        } catch (e) {
            console.error(`Failed to fetch RSS from ${url}`, e);
        }
    }
    // Return posts from last 48 hours
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    return posts.filter(p => p.date > twoDaysAgo).map(p => `Published blog: "${p.title}"`);
}

// Feature: Get last active repo for fallback message
async function getLastActiveRepo(token) {
    const headers = { 'User-Agent': 'node.js' };
    if (token) headers['Authorization'] = `token ${token}`;

    // Fetch user's repos sorted by updated desc
    const response = await fetch(`https://api.github.com/users/${GITHUB_USERNAME}/repos?sort=pushed&per_page=1`, { headers });
    if (!response.ok) return 'projects';

    const repos = await response.json();
    return repos.length > 0 ? repos[0].name : 'projects';
}

async function generateSummary(activityLog, lastRepo) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.log('No GEMINI_API_KEY provided. Skipping summary generation.');
        return null; // Return null to skip update without error
    }

    const profileContext = `
    PROFILE CONTEXT:
    - Current Role: QA Automation Engineer @ Infosys (since Oct 2021).
    - Career Goal: Seeking Senior QA Automation roles OR Full Stack Development positions (open to both).
    - mindset: "Whichever opportunity offers better growth and pay." Open to learning any new skill.
    - Core Stack (QA): Java, Selenium, Maven, Rest Assured.
    - Dev Stack (Learning/Building): Python, Django, React, Next.js, Flutter.
    - Key Project: "ProjektNotify" (building in public).
    `;

    const prompt = `
    You are managing the "About Me" and "Tech Stack" sections for my GitHub Profile ("${GITHUB_USERNAME}").
    
    ${profileContext}

    RECENT ACTIVITY (Last 48h):
    ${activityLog.join('\n')}
    
    TASK: Generate a JSON object with two fields: "bio" and "tech_stack".
    
    1. "bio": A dynamic, engaging, professional intro (2-3 sentences).
       - Combine my PERMANENT identity (QA -> Aspiring Dev) with my RECENT activity.
       - TONE: Energetic, Professional, driven. First Person ("I").
    
    2. "tech_stack": A Markdown list of my stack.
       - Format:
         - **Core Stack:** [Badges for Java, Selenium, Maven, Rest Assured, Appium]
         - **Focus:** delivering high-quality software through automated testing and continuous integration.
         - **Current Learning:** [Badges for Python, Django, React, Next.js, Flutter - prioritize based on recent activity if any, otherwise list all].
       - Use "for-the-badge" style shields.io images.
    
    OUTPUT FORMAT:
    {
      "bio": "...",
      "tech_stack": "..."
    }
    Return ONLY valid JSON.
    `;

    // Gemini API Payload
    const payload = {
        contents: [{
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            maxOutputTokens: 1000, // Increased for stack
            responseMimeType: "application/json" // Force JSON
        }
    };

    // Append API key to URL query param
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini API Error: ${err}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) return null;

        // Parse JSON
        return JSON.parse(rawText);

    } catch (error) {
        console.error('Error with Gemini API:', error.message);
        return null; // Return null to skip update without error
    }
}

// Helper to clear summary if API key is removed
async function clearSummary() {
    const readmePath = path.join(__dirname, '../../README.md');
    let readmeContent = fs.readFileSync(readmePath, 'utf8');

    const bioStart = '<!-- AI-SUMMARY:START -->';
    const bioEnd = '<!-- AI-SUMMARY:END -->';
    const newBioSection = `${bioStart}\n${bioEnd}`; // Empty content between markers

    const stackStart = '<!-- AI-STACK:START -->';
    const stackEnd = '<!-- AI-STACK:END -->';
    const newStackSection = `${stackStart}\n${stackEnd}`;

    let updated = false;

    const bioRegex = new RegExp(`${bioStart}[\\s\\S]*?${bioEnd}`);
    if (readmeContent.match(bioRegex)) {
        const currentContent = readmeContent.match(bioRegex)[0];
        if (currentContent.trim() !== newBioSection.trim()) {
            readmeContent = readmeContent.replace(bioRegex, newBioSection);
            updated = true;
        }
    }

    const stackRegex = new RegExp(`${stackStart}[\\s\\S]*?${stackEnd}`);
    if (readmeContent.match(stackRegex)) {
        const currentContent = readmeContent.match(stackRegex)[0];
        if (currentContent.trim() !== newStackSection.trim()) {
            readmeContent = readmeContent.replace(stackRegex, newStackSection);
            updated = true;
        }
    }

    if (updated) {
        fs.writeFileSync(readmePath, readmeContent);
        console.log('Cleared AI summary and stack from README (No API Key provided).');
    } else {
        console.log('AI summary and stack sections are already empty.');
    }
}

async function main() {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.log('No GEMINI_API_KEY provided. Cleaning up...');
            await clearSummary();
            return;
        }

        console.log('Fetching activity...');
        const token = process.env.GH_PAT || process.env.GITHUB_TOKEN;
        const githubActivity = await getRecentGithubActivity(token);
        const blogActivity = await getRecentBlogPosts();

        const activityLog = [...githubActivity, ...blogActivity];
        console.log('Activity Log:', activityLog);

        console.log('Fetching last active repo...');
        const lastRepo = await getLastActiveRepo(token);
        console.log('Last Active Repo:', lastRepo);

        const aiData = await generateSummary(activityLog, lastRepo);

        if (!aiData) {
            console.log('No AI generation produced. Skipping.');
            return;
        }

        const { bio, tech_stack } = aiData;
        console.log('Generated Bio:', bio);
        console.log('Generated Stack:', tech_stack);

        // Update README
        const readmePath = path.join(__dirname, '../../README.md');
        let readmeContent = fs.readFileSync(readmePath, 'utf8');

        // 1. Update Bio
        const bioStart = '<!-- AI-SUMMARY:START -->';
        const bioEnd = '<!-- AI-SUMMARY:END -->';
        const newBioSection = `${bioStart}\n${bio}\n${bioEnd}`;

        const bioRegex = new RegExp(`${bioStart}[\\s\\S]*?${bioEnd}`);
        if (readmeContent.match(bioRegex)) {
            readmeContent = readmeContent.replace(bioRegex, newBioSection);
        } else {
            console.log('AI Summary markers not found.');
        }

        // 2. Update Tech Stack
        const stackStart = '<!-- AI-STACK:START -->';
        const stackEnd = '<!-- AI-STACK:END -->';
        const newStackSection = `${stackStart}\n${tech_stack}\n${stackEnd}`;

        const stackRegex = new RegExp(`${stackStart}[\\s\\S]*?${stackEnd}`);
        if (readmeContent.match(stackRegex)) {
            readmeContent = readmeContent.replace(stackRegex, newStackSection);
        } else {
            console.log('Stack markers not found in README.');
        }

        fs.writeFileSync(readmePath, readmeContent);
        console.log('README updated successfully with Bio and Stack.');

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}


main();
