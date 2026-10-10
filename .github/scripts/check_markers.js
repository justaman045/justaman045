const fs = require('fs');
const path = require('path');

const readmePath = path.join(__dirname, '../../README.md');

const SECTIONS = [
    'AI-NAME',
    'AI-HEADER',
    'AI-SUMMARY',
    'AI-ROLE',
    'AI-STACK',
    'AI-BANNER',
    'AI-PROJECT',
    'AI-CONNECT',
    'DURATION',
    'BLOG-POST-LIST',
    'RECENT-REPOS',
    'TOP-PROJECTS'
];

const EXTRA_PATTERNS = [
    /<!--START_SECTION:waka-->[\s\S]*?<!--END_SECTION:waka-->/
];

function main() {
    if (!fs.existsSync(readmePath)) {
        console.error(`README not found at ${readmePath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(readmePath, 'utf8');
    const missing = [];

    for (const section of SECTIONS) {
        const startMarker = `<!-- ${section}:START -->`;
        const endMarker = `<!-- ${section}:END -->`;
        const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
        if (!regex.test(content)) {
            missing.push(`${section} (${startMarker} ... ${endMarker})`);
        }
    }

    for (const pattern of EXTRA_PATTERNS) {
        if (!pattern.test(content)) {
            missing.push(String(pattern));
        }
    }

    if (missing.length > 0) {
        console.error(`Missing README sections:\n- ${missing.join('\n- ')}`);
        process.exit(1);
    }

    console.log('All README sections present.');
}

main();