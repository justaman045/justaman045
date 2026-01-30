const fs = require('fs');
const path = require('path');

const startDate = new Date('2021-10-25T00:00:00Z');
const now = new Date();

let years = now.getFullYear() - startDate.getFullYear();
let months = now.getMonth() - startDate.getMonth();
let days = now.getDate() - startDate.getDate();

if (days < 0) {
    months--;
    // Get days in previous month
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonth;
}

if (months < 0) {
    years--;
    months += 12;
}

const durationParts = [];
if (years > 0) durationParts.push(`${years} year${years > 1 ? 's' : ''}`);
if (months > 0) durationParts.push(`${months} month${months > 1 ? 's' : ''}`);
if (days > 0) durationParts.push(`${days} day${days > 1 ? 's' : ''}`);

const durationString = durationParts.join(', ');

const readmePath = path.join(__dirname, '../../README.md');
let readmeContent = fs.readFileSync(readmePath, 'utf8');

const startMarker = '<!-- DURATION:START -->';
const endMarker = '<!-- DURATION:END -->';

const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
const newContent = `${startMarker}${durationString}${endMarker}`;

if (readmeContent.match(regex)) {
    readmeContent = readmeContent.replace(regex, newContent);
    fs.writeFileSync(readmePath, readmeContent);
    console.log(`Updated README with duration: ${durationString}`);
} else {
    console.log('Duration markers not found in README.');
}
