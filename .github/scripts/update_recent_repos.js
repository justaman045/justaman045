const fs = require('fs');
const path = require('path');
const https = require('https');

const username = 'justaman045';
const readmePath = path.join(__dirname, '../../README.md');

// Function to fetch data from GitHub API
function fetchData(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'node.js',
                'Authorization': process.env.GITHUB_TOKEN ? `token ${process.env.GITHUB_TOKEN}` : undefined
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

async function updateReadme() {
    try {
        console.log('Fetching repositories...');
        const repos = await fetchData(`https://api.github.com/users/${username}/repos?sort=pushed&per_page=100&type=owner`);

        // Filter out forks and get top 3 recently pushed
        const recentRepos = repos
            .filter(repo => !repo.fork)
            .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
            .slice(0, 3);

        console.log(`Found ${recentRepos.length} recent repositories.`);

        if (recentRepos.length === 0) {
            console.log('No repositories found.');
            return;
        }

        // Generate HTML
        let reposHtml = '<div align="center">\n';
        recentRepos.forEach(repo => {
            reposHtml += `  <a href="${repo.html_url}">\n`;
            reposHtml += `    <img src="https://github-readme-stats.vercel.app/api/pin/?username=${username}&repo=${repo.name}&theme=github_dark" />\n`;
            reposHtml += `  </a>\n`;
        });
        reposHtml += '</div>';

        // Read README
        let readmeContent = fs.readFileSync(readmePath, 'utf8');

        // Replace content
        const startMarker = '<!-- RECENT-REPOS:START -->';
        const endMarker = '<!-- RECENT-REPOS:END -->';
        const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
        const newContent = `${startMarker}\n${reposHtml}\n${endMarker}`;

        if (readmeContent.match(regex)) {
            readmeContent = readmeContent.replace(regex, newContent);
            fs.writeFileSync(readmePath, readmeContent);
            console.log('README updated successfully.');
        } else {
            console.log('Recent repos markers not found in README.');
        }

    } catch (error) {
        console.error('Error updating properties:', error.message);
        process.exit(1);
    }
}

updateReadme();
