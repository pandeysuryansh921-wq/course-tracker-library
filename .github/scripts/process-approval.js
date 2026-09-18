const fs = require('fs');
const path = require('path');

const issueBody = process.env.ISSUE_BODY || '';
const issueTitle = process.env.ISSUE_TITLE || '';
const issueAuthor = process.env.ISSUE_AUTHOR || 'Community Contributor';

console.log('Processing submission from issue:', issueTitle);

// 1. Extract JSON block from markdown issue body
const match = issueBody.match(/```json\s*([\s\S]*?)\s*```/) || issueBody.match(/\{[\s\S]*\}/);
if (!match) {
  console.error('Error: No valid JSON code block found in issue body.');
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(match[1] || match[0]);
} catch (err) {
  console.error('Error: Failed to parse JSON block:', err.message);
  process.exit(1);
}

// 2. Resolve target directories
const rootDir = path.resolve(__dirname, '..', '..');
const coursesDir = path.join(rootDir, 'courses');
if (!fs.existsSync(coursesDir)) {
  fs.mkdirSync(coursesDir, { recursive: true });
}

const coursesJsonPath = path.join(rootDir, 'courses.json');
let coursesList = [];
if (fs.existsSync(coursesJsonPath)) {
  try {
    coursesList = JSON.parse(fs.readFileSync(coursesJsonPath, 'utf8'));
  } catch (e) {
    coursesList = [];
  }
}

const resourcesJsonPath = path.join(rootDir, 'resources.json');
let resourcesList = [];
if (fs.existsSync(resourcesJsonPath)) {
  try {
    resourcesList = JSON.parse(fs.readFileSync(resourcesJsonPath, 'utf8'));
  } catch (e) {
    resourcesList = [];
  }
}

// 3. Process Course Curriculum
if (payload.version === 'degreetrack.curriculum.v1' || payload.course) {
  const courseTitle = payload.course?.title || payload.course?.name || issueTitle.replace(/^\[.*?\]:\s*/, '').trim() || 'Community Course';
  const slug = courseTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 45) || 'course';
  
  const filename = `courses/${slug}.json`;
  const filePath = path.join(rootDir, filename);

  // Write the complete curriculum file
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

  // Register in courses.json
  const existingIdx = coursesList.findIndex(c => c.filename === filename || c.title.toLowerCase() === courseTitle.toLowerCase());
  const entry = {
    id: payload.course?.id || `course_${slug}`,
    title: courseTitle,
    author: issueAuthor,
    description: payload.course?.description || 'Community curriculum submission.',
    filename: filename
  };

  if (existingIdx >= 0) {
    coursesList[existingIdx] = entry;
  } else {
    coursesList.push(entry);
  }

  fs.writeFileSync(coursesJsonPath, JSON.stringify(coursesList, null, 2), 'utf8');
  console.log(`Successfully approved and published course: "${courseTitle}" -> ${filename}`);

// 4. Process Community Resource or Manifest
} else if (payload.version === 'degreetrack.community.v1' || payload.resource || payload.resources) {
  const itemsToAdd = [];

  const addSingleResource = (resPayload) => {
    const r = resPayload.resource || resPayload;
    const url = r.canonicalUrl || r.url;
    if (!url) return;

    const title = r.title || issueTitle.replace(/^\[.*?\]:\s*/, '').trim() || 'Community Resource';
    itemsToAdd.push({
      id: `comm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title,
      url,
      type: (r.type?.toLowerCase() || 'article'),
      role: r.role || 'PRIMARY',
      category: resPayload.context?.topics?.[0] || 'Community',
      description: r.description || `Community resource with confidence ${resPayload.metrics?.confidenceScore || 0}`
    });
  };

  if (Array.isArray(payload.resources)) {
    payload.resources.forEach(r => addSingleResource(r));
  } else {
    addSingleResource(payload);
  }

  if (itemsToAdd.length === 0) {
    console.error('Error: No valid resources found in payload.');
    process.exit(1);
  }

  // Merge avoiding duplicates by URL
  itemsToAdd.forEach(newItem => {
    const existingIdx = resourcesList.findIndex(existing => existing.url === newItem.url);
    if (existingIdx >= 0) {
      resourcesList[existingIdx] = newItem;
    } else {
      resourcesList.push(newItem);
    }
    console.log(`Published resource: "${newItem.title}" (${newItem.url})`);
  });

  fs.writeFileSync(resourcesJsonPath, JSON.stringify(resourcesList, null, 2), 'utf8');
  console.log(`Updated resources.json with ${itemsToAdd.length} resource(s).`);

} else {
  console.error('Error: Unrecognized payload schema.');
  process.exit(1);
}
