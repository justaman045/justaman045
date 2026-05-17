const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_USERNAME = 'justaman045';
const RSS_URLS = [
    'https://justaman045.hashnode.dev/rss.xml',
    'https://dev.to/feed/justaman045'
];
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

function getAuthHeaders(token) {
    const headers = { 'User-Agent': 'node.js' };
    if (token) headers['Authorization'] = `token ${token}`;
    return headers;
}

async function getAllRepos(token) {
    const headers = getAuthHeaders(token);
    const response = await fetch(
        `https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100&type=owner&sort=updated`, // NOTE: max 100 repos — oldest silently dropped if exceeded
        { headers }
    );
    if (!response.ok) {
        console.warn(`Failed to fetch repos: HTTP ${response.status}`);
        return [];
    }
    const repos = await response.json();
    return repos
        .filter(r => !r.fork)
        .map(r => ({
            name: r.name,
            description: r.description || '',
            language: r.language || '',
            topics: r.topics || [],
            stars: r.stargazers_count || 0,
            forks: r.forks_count || 0,
            private: r.private || false,
            created_at: r.created_at,
            pushed_at: r.pushed_at,
            html_url: r.html_url
        }))
        .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
}

async function getRepoReadme(token, repoName) {
    const headers = getAuthHeaders(token);
    headers['Accept'] = 'application/vnd.github.raw+json';
    try {
        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${repoName}/readme`,
            { headers }
        );
        if (!response.ok) {
            if (response.status === 403) {
                console.warn(`  Rate limited or no access for ${repoName}, skipping README`);
            } else if (response.status !== 404) {
                console.warn(`  Failed to fetch README for ${repoName}: HTTP ${response.status}`);
            }
            return null;
        }
        const text = await response.text();
        return text.length > 4000 ? text.slice(0, 4000) + '\n... [truncated]' : text;
    } catch (e) {
        console.warn(`  Error fetching README for ${repoName}: ${e.message}`);
        return null;
    }
}

async function getExpandedActivity(token) {
    const headers = getAuthHeaders(token);
    const response = await fetch(
        `https://api.github.com/users/${GITHUB_USERNAME}/events?per_page=100`,
        { headers }
    );
    if (!response.ok) return [];

    const events = await response.json();
    return events.map(e => {
        if (e.type === 'PushEvent') {
            const commitCount = e.payload.size || (e.payload.commits ? e.payload.commits.length : 0);
            const commits = e.payload.commits || [];
            const msgs = commits.map(c => c.message).join(', ') || 'No specific commit messages';
            if (commitCount === 0) return null;
            return `Pushed ${commitCount} commits to ${e.repo.name}: ${msgs}`;
        }
        if (e.type === 'CreateEvent') return `Created ${e.payload.ref_type} in ${e.repo.name}`;
        return `${e.type} on ${e.repo.name}`;
    }).filter(Boolean);
}

async function getRecentBlogPosts() {
    const posts = [];
    for (const url of RSS_URLS) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const xml = await response.text();

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
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    return posts.filter(p => p.date > twoDaysAgo).map(p => `Published blog: "${p.title}"`);
}

async function generateSummary(activityLog, repos, readmeMap, resumeBase64) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.log('No GEMINI_API_KEY provided. Skipping summary generation.');
        return null;
    }

    const activityText = activityLog.length > 0
        ? activityLog.join('\n')
        : 'No recent activity detected.';

    const repoTable = repos.map(r =>
        `| ${r.private ? '🔒' : '🌍'} ${r.name} | ${(r.description || '').slice(0, 80)} | ${r.language} | ${r.stars} ★ | ${r.created_at ? r.created_at.slice(0, 10) : '?'} |`
    ).join('\n');

    const readmeSection = repos
        .filter(r => readmeMap[r.name])
        .map(r => `--- ${r.name} ---\n${readmeMap[r.name]}`)
        .join('\n\n');

    const contextNote = repos.length === 0
        ? '\n[Could not fetch repository catalog — API may be rate-limited]'
        : '';

    const prompt = `You are managing the "About Me" and "Tech Stack" sections for my GitHub Profile ("${GITHUB_USERNAME}").

MY RESUME (attached PDF):
My complete professional resume is attached as a PDF. Extract all details from it — my career goals, skills, experience, education, certifications, and everything else.

MY FULL REPOSITORY CATALOG (all my projects, including private ones):
| Repo | Description | Language | Stars | Created |
|---|---|---|---|---|
${repoTable}
${contextNote}

README CONTENTS FOR KEY PROJECTS:
${readmeSection || '(No READMEs fetched)'}

RECENT GITHUB ACTIVITY (last ~100 events):
${activityText}

TASK: Generate a JSON object with exactly four fields: "header", "bio", "tech_stack", and "banner".

1. "header": A 1-line subtitle with my role titles derived from the resume.
   - Format: 👨‍💻 {Primary Role} | 🚀 {Secondary Role or Aspiration}
   - Extract the roles from the attached resume.
   - If the resume mentions multiple distinct roles, reflect the top two.
   - Example: "👨‍💻 SDET | 🚀 Full Stack Developer"

2. "bio": A dynamic, engaging professional introduction (2-3 sentences).
   - First, deeply understand my full career story from the attached resume.
   - Then contextualize it with my actual projects and recent activity.
   - Derive my professional identity entirely from the attached resume — extract roles, career story, and positioning from the PDF, not from assumptions.
   - Reference specific projects or technologies from the repo catalog when relevant.
   - Mention recent activity to show I'm actively building.
   - TONE: Energetic, professional, driven. First person ("I").

3. "tech_stack": A Markdown list of my technology stack.
   - Format exactly like this:
     - **Core Stack:** [Badges for my primary professional skills from my resume]
     - **Focus:** [One sentence summarizing my main professional focus]
     - **Current Learning:** [Badges for technologies I'm learning or building with, based on repos + recent activity]
   - Use "for-the-badge" style shields.io badge images.
   - Include languages and frameworks from both my resume AND my actual repos.

4. "banner": A 1-line professional callout about my current availability.
   - Reflect my current job-seeking status from the resume and recent activity.
   - Mention specific roles I am targeting.
   - Keep it to 1-2 lines, Markdown bold.
   - If I'm not actively seeking, set to empty string.

OUTPUT FORMAT:
{
  "header": "...",
  "bio": "...",
  "tech_stack": "...",
  "banner": "... or empty string"
}
Return ONLY valid JSON.`;

    const parts = [];
    if (resumeBase64) {
        parts.push({
            inlineData: {
                mimeType: "application/pdf",
                data: resumeBase64
            }
        });
    }
    parts.push({ text: prompt });

    const payload = {
        contents: [{ parts }],
        generationConfig: {
            maxOutputTokens: 8192,
        }
    };

    const url = `${GEMINI_API_URL}?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini API Error: ${err}`);
        }

        const data = await response.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) return null;

        const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        console.log('Raw Gemini Output:', cleanedText);
        return JSON.parse(cleanedText);
    } catch (error) {
        console.error('Error with Gemini API:', error.message);
        return null;
    }
}

async function clearSummary() {
    const readmePath = path.join(__dirname, '../../README.md');
    let readmeContent = fs.readFileSync(readmePath, 'utf8');

    const bioStart = '<!-- AI-SUMMARY:START -->';
    const bioEnd = '<!-- AI-SUMMARY:END -->';
    const newBioSection = `${bioStart}\n${bioEnd}`;

    const stackStart = '<!-- AI-STACK:START -->';
    const stackEnd = '<!-- AI-STACK:END -->';
    const newStackSection = `${stackStart}\n${stackEnd}`;

    const bannerStart = '<!-- AI-BANNER:START -->';
    const bannerEnd = '<!-- AI-BANNER:END -->';
    const newBannerSection = `${bannerStart}\n${bannerEnd}`;

    const headerStart = '<!-- AI-HEADER:START -->';
    const headerEnd = '<!-- AI-HEADER:END -->';
    const newHeaderSection = `${headerStart}\n${headerEnd}`;

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

    const bannerRegex = new RegExp(`${bannerStart}[\\s\\S]*?${bannerEnd}`);
    if (readmeContent.match(bannerRegex)) {
        const currentContent = readmeContent.match(bannerRegex)[0];
        if (currentContent.trim() !== newBannerSection.trim()) {
            readmeContent = readmeContent.replace(bannerRegex, newBannerSection);
            updated = true;
        }
    }

    const headerRegex = new RegExp(`${headerStart}[\\s\\S]*?${headerEnd}`);
    if (readmeContent.match(headerRegex)) {
        const currentContent = readmeContent.match(headerRegex)[0];
        if (currentContent.trim() !== newHeaderSection.trim()) {
            readmeContent = readmeContent.replace(headerRegex, newHeaderSection);
            updated = true;
        }
    }

    if (updated) {
        fs.writeFileSync(readmePath, readmeContent);
        console.log('Cleared AI header, summary, stack, and banner from README (No API Key provided).');
    } else {
        console.log('AI header, summary, stack, and banner sections are already empty.');
    }
}

function getRepoPriority(repo) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const pushedDate = new Date(repo.pushed_at);
    if (pushedDate < sixMonthsAgo) return 0;
    const hasDescription = repo.description && repo.description.length > 10;
    return (repo.stars * 2) + (hasDescription ? 3 : 0) + (repo.forks > 0 ? 1 : 0);
}

async function main() {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.log('No GEMINI_API_KEY provided. Cleaning up...');
            await clearSummary();
            return;
        }

        const token = process.env.GH_PAT || process.env.GITHUB_TOKEN;

        console.log('Fetching all repositories (including private)...');
        const allRepos = await getAllRepos(token);
        console.log(`Found ${allRepos.length} non-fork repos`);

        console.log('Fetching READMEs for significant repos...');
        const readmeMap = {};
        const readmeCandidates = allRepos
            .map(r => ({ ...r, priority: getRepoPriority(r) }))
            .filter(r => r.priority > 0)
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 8);

        for (const repo of readmeCandidates) {
            console.log(`  Fetching README for ${repo.name}...`);
            const readme = await getRepoReadme(token, repo.name);
            if (readme) {
                readmeMap[repo.name] = readme;
                console.log(`    Got README (${readme.length} chars)`);
            }
        }
        console.log(`Fetched ${Object.keys(readmeMap).length} READMEs`);

        console.log('Fetching expanded activity...');
        const githubActivity = await getExpandedActivity(token);
        const blogActivity = await getRecentBlogPosts();

        const activityLog = [...githubActivity, ...blogActivity];
        console.log(`Activity entries: ${activityLog.length}`);

        console.log('Reading resume PDF...');
        const resumePath = path.join(__dirname, '../../resume.pdf');
        let resumeBase64 = '';
        try {
            const resumeBuffer = fs.readFileSync(resumePath);
            resumeBase64 = resumeBuffer.toString('base64');
            console.log(`Resume PDF loaded (${resumeBase64.length} base64 chars)`);
        } catch (err) {
            console.warn('Could not read resume PDF, proceeding without it:', err.message);
        }

        console.log('Generating AI summary...');
        const aiData = await generateSummary(activityLog, allRepos, readmeMap, resumeBase64);

        if (!aiData) {
            console.log('No AI generation produced. Skipping.');
            return;
        }

        const { header, bio, tech_stack, banner } = aiData;
        console.log('Generated Header:', header);
        console.log('Generated Bio:', bio);
        console.log('Generated Stack:', tech_stack);
        console.log('Generated Banner:', banner);

        const readmePath = path.join(__dirname, '../../README.md');
        let readmeContent = fs.readFileSync(readmePath, 'utf8');

        const bioStart = '<!-- AI-SUMMARY:START -->';
        const bioEnd = '<!-- AI-SUMMARY:END -->';
        const newBioSection = `${bioStart}\n${bio}\n${bioEnd}`;

        const bioRegex = new RegExp(`${bioStart}[\\s\\S]*?${bioEnd}`);
        if (readmeContent.match(bioRegex)) {
            readmeContent = readmeContent.replace(bioRegex, newBioSection);
        } else {
            console.log('AI Summary markers not found.');
        }

        const stackStart = '<!-- AI-STACK:START -->';
        const stackEnd = '<!-- AI-STACK:END -->';
        const newStackSection = `${stackStart}\n${tech_stack}\n${stackEnd}`;

        const stackRegex = new RegExp(`${stackStart}[\\s\\S]*?${stackEnd}`);
        if (readmeContent.match(stackRegex)) {
            readmeContent = readmeContent.replace(stackRegex, newStackSection);
        } else {
            console.log('Stack markers not found in README.');
        }

        const bannerStart = '<!-- AI-BANNER:START -->';
        const bannerEnd = '<!-- AI-BANNER:END -->';
        const bannerContent = banner ? `> ${banner}` : '';
        const newBannerSection = `${bannerStart}\n${bannerContent}\n${bannerEnd}`;

        const bannerRegex = new RegExp(`${bannerStart}[\\s\\S]*?${bannerEnd}`);
        if (readmeContent.match(bannerRegex)) {
            readmeContent = readmeContent.replace(bannerRegex, newBannerSection);
        } else {
            console.log('Banner markers not found in README.');
        }

        const headerStart = '<!-- AI-HEADER:START -->';
        const headerEnd = '<!-- AI-HEADER:END -->';
        const newHeaderSection = `${headerStart}\n### ${header}\n${headerEnd}`;

        const headerRegex = new RegExp(`${headerStart}[\\s\\S]*?${headerEnd}`);
        if (readmeContent.match(headerRegex)) {
            readmeContent = readmeContent.replace(headerRegex, newHeaderSection);
        } else {
            console.log('Header markers not found in README.');
        }

        fs.writeFileSync(readmePath, readmeContent);
        console.log('README updated successfully with Header, Bio, Stack, and Banner.');

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
