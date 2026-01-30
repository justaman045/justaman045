const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const RSS_URLS = [
    'https://coderaman7.hashnode.dev/rss.xml',
    'https://dev.to/feed/justaman045'
];
const MAX_POSTS = 5;

// Helper to fetch data with User-Agent to avoid 403
const fetch = (url) => {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        };

        const req = https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                text: () => data
            }));
        });
        req.on('error', reject);
    });
};

async function getBlogPosts() {
    const posts = [];

    for (const url of RSS_URLS) {
        try {
            console.log(`Fetching RSS from ${url}...`);
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`Failed to fetch ${url}: Status ${response.status}`);
                continue;
            }

            const xml = await response.text();

            // Simple Regex XML Parser
            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let match;

            while ((match = itemRegex.exec(xml)) !== null) {
                const item = match[1];

                // Extract fields
                const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
                const linkMatch = item.match(/<link>(.*?)<\/link>/);
                const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

                if (titleMatch && linkMatch && pubDateMatch) {
                    posts.push({
                        title: titleMatch[1],
                        link: linkMatch[1],
                        date: new Date(pubDateMatch[1])
                    });
                }
            }
        } catch (e) {
            console.error(`Error processing ${url}:`, e.message);
        }
    }

    // Sort by date desc and slice
    return posts
        .sort((a, b) => b.date - a.date)
        .slice(0, MAX_POSTS);
}

async function main() {
    try {
        const posts = await getBlogPosts();

        if (posts.length === 0) {
            console.log('No posts found.');
            return;
        }

        // Generate Markdown List
        // Example: - [Title](Link)
        const postList = posts.map(p => `- [${p.title}](${p.link})`).join('\n');

        // Update README
        const readmePath = path.join(__dirname, '../../README.md');
        let readmeContent = fs.readFileSync(readmePath, 'utf8');

        // Markers
        const startMarker = '<!-- BLOG-POST-LIST:START -->';
        const endMarker = '<!-- BLOG-POST-LIST:END -->';

        const newContent = `${startMarker}\n${postList}\n${endMarker}`;

        const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);

        if (readmeContent.match(regex)) {
            readmeContent = readmeContent.replace(regex, newContent);
            fs.writeFileSync(readmePath, readmeContent);
            console.log('README updated with latest blog posts.');
        } else {
            console.error('Blog sections markers not found in README.');
        }

    } catch (error) {
        console.error('Script failed:', error);
        process.exit(1);
    }
}

main();
