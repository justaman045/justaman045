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
    return events.slice(0, 10).map(e => {
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

    const prompt = `
    You are a professional assistant for "${GITHUB_USERNAME}", a QA Automation Engineer and Aspiring Full Stack Developer.
    
    Here is the recent activity (last 24-48 hours):
    ${activityLog.join('\n')}
    
    TASK: Write a very short, professional, and engaging daily summary (1-2 sentences max) in the first person ("I").
    
    RULES:
    1. If there is RECENT activity in the log above, highlight it specificially.
    2. If the log is EMPTY or has no significant activity, you MUST use this fallback pattern:
       "Currently building ${lastRepo} and learning new skills on the way." (You can vary the wording slightly but keep the meaning: working on that repo + learning).
    
    Tone: Professional, enthusiastic, concise.
    `;

    // Gemini API Payload
    const body = JSON.stringify({
        contents: [{
            parts: [{ text: prompt }]
        }]
    });

    // Append API key to URL query param
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API Error: ${err}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim();
}

// Helper to clear summary if API key is removed
async function clearSummary() {
    const readmePath = path.join(__dirname, '../../README.md');
    let readmeContent = fs.readFileSync(readmePath, 'utf8');

    const startMarker = '<!-- AI-SUMMARY:START -->';
    const endMarker = '<!-- AI-SUMMARY:END -->';
    const newSection = `${startMarker}\n${endMarker}`; // Empty content between markers

    const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
    if (readmeContent.match(regex)) {
        const currentContent = readmeContent.match(regex)[0];
        // Only write if there's actual content to clear (avoid empty commits)
        if (currentContent.trim() !== newSection.trim()) {
            readmeContent = readmeContent.replace(regex, newSection);
            fs.writeFileSync(readmePath, readmeContent);
            console.log('Cleared AI summary from README (No API Key provided).');
        } else {
            console.log('AI summary is already empty.');
        }
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

        const summary = await generateSummary(activityLog, lastRepo);

        if (!summary) return;

        console.log('Generated Summary:', summary);

        // Update README
        const readmePath = path.join(__dirname, '../../README.md');
        let readmeContent = fs.readFileSync(readmePath, 'utf8');

        const startMarker = '<!-- AI-SUMMARY:START -->';
        const endMarker = '<!-- AI-SUMMARY:END -->';

        // Formatted Markdown Section
        const newSection = `${startMarker}\n> 🤖 **Daily Summary:** ${summary}\n${endMarker}`;

        const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
        if (readmeContent.match(regex)) {
            readmeContent = readmeContent.replace(regex, newSection);
            fs.writeFileSync(readmePath, readmeContent);
            console.log('README updated with AI summary.');
        } else {
            console.log('AI Summary markers not found.');
        }

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}


main();
