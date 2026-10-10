const fs = require('fs');
const path = require('path');
const https = require('https');

const username = 'justaman045';
const readmePath = path.join(__dirname, '../../README.md');
const PER_PAGE = 100;
const MAX_REPOS = 300;
const TOP_COUNT = 6;

function fetchData(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'node.js',
                'Authorization': process.env.GH_PAT ? `token ${process.env.GH_PAT}` : (process.env.GITHUB_TOKEN ? `token ${process.env.GITHUB_TOKEN}` : undefined)
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Request failed with status code ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function fetchAllRepos() {
    const repos = [];
    for (let page = 1; page <= Math.ceil(MAX_REPOS / PER_PAGE); page++) {
        const batch = await fetchData(`https://api.github.com/users/${username}/repos?sort=pushed&per_page=${PER_PAGE}&page=${page}&type=owner`);
        repos.push(...batch);
        if (batch.length < PER_PAGE) break;
    }
    return repos;
}

function score(repo) {
    const stars = repo.stargazers_count || 0;
    const hasDescription = repo.description ? 3 : 0;
    const forks = repo.forks_count || 0;
    const recency = new Date(repo.pushed_at).getTime() > Date.now() - 90 * 24 * 60 * 60 * 1000 ? 1 : 0;
    return (stars * 2) + hasDescription + forks + recency;
}

async function updateReadme() {
    try {
        console.log('Fetching repositories...');
        const repos = await fetchAllRepos();

        const candidates = repos.filter(repo => {
            if (repo.name.toLowerCase() === username.toLowerCase()) return false;
            if (repo.fork) return false;
            if (repo.private) return false;
            if (repo.archived) return false;
            if (!repo.description) return false;
            return true;
        });

        const top = candidates
            .sort((a, b) => score(b) - score(a))
            .slice(0, TOP_COUNT);

        console.log(`Found ${top.length} top public projects.`);

        if (top.length === 0) {
            console.log('No projects found.');
            return;
        }

        let table = '| 🌟 Project | 📖 Description | ⭐ Stars | 🗒 Created |\n';
        table += '| :--- | :--- | :--- | :--- |\n';

        top.forEach(repo => {
            const desc = repo.description.slice(0, 100) + (repo.description.length > 100 ? '...' : '');
            const stars = repo.stargazers_count || 0;
            table += `| **[${repo.name}](${repo.html_url})** | ${desc} | ${stars} | ${repo.created_at.slice(0, 10)} |\n`;
        });

        const readmeContent = fs.readFileSync(readmePath, 'utf8');

        const startMarker = '<!-- TOP-PROJECTS:START -->';
        const endMarker = '<!-- TOP-PROJECTS:END -->';
        const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
        const newContent = `${startMarker}\n${table}\n${endMarker}`;

        if (readmeContent.match(regex)) {
            const updated = readmeContent.replace(regex, newContent);
            fs.writeFileSync(readmePath, updated);
            console.log('README updated with top projects.');
        } else {
            console.error('TOP-PROJECTS markers not found in README.');
        }
    } catch (error) {
        // Never destroy an existing section on failure: only a single atomic
        // writeFileSync at the end mutates the file, so reaching here leaves the
        // TOP-PROJECTS section exactly as it was.
        console.error('Error updating top projects (section left unchanged):', error.message);
        process.exit(1);
    }
}

updateReadme();