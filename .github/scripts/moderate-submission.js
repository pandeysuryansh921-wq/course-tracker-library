const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Environment inputs from GitHub Actions context
const issueBody = process.env.ISSUE_BODY || '';
const issueTitle = process.env.ISSUE_TITLE || '';
const issueAuthor = process.env.ISSUE_AUTHOR || 'Community Contributor';
const issueNumber = process.env.ISSUE_NUMBER || '0';
const triggerType = process.env.TRIGGER_TYPE || 'auto'; // 'auto' or 'manual_approve'

console.log(`[Moderator] Starting submission moderation for #${issueNumber}: "${issueTitle}" (Trigger: ${triggerType})`);

// 1. Root and Community Directories
const rootDir = path.resolve(__dirname, '..', '..');
const communityDir = path.join(rootDir, 'community');
const coursesDir = path.join(communityDir, 'courses');
const resourcesDir = path.join(communityDir, 'resources');

[communityDir, coursesDir, resourcesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const manifestPath = path.join(communityDir, 'manifest.json');
const coursesIndexPath = path.join(coursesDir, 'index.json');
const resourcesIndexPath = path.join(resourcesDir, 'index.json');
const legacyCoursesPath = path.join(rootDir, 'courses.json');
const legacyResourcesPath = path.join(rootDir, 'resources.json');

function loadJson(filePath, fallback = []) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.warn(`[Moderator] Warning: Failed to read ${filePath}, using fallback:`, e.message);
  }
  return fallback;
}

// 2. Extract JSON payload from issue body
function extractJsonPayload(body) {
  const codeBlockMatch = body.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (err) {
      console.error('[Moderator] Failed to parse fenced JSON block:', err.message);
    }
  }

  // Fallback: try raw JSON search
  const rawMatch = body.match(/\{[\s\S]*\}/);
  if (rawMatch) {
    try {
      return JSON.parse(rawMatch[0].trim());
    } catch (err) {
      console.error('[Moderator] Failed to parse raw JSON block:', err.message);
    }
  }

  return null;
}

// 3. Privacy Firewall & Credential Scanning
const STRICT_FORBIDDEN_KEYS = new Set([
  'userid',
  'email',
  'userprofile',
  'personalnotes',
  'notes',
  'journal',
  'reflections',
  'quizscore',
  'quizscores',
  'mastery',
  'masteryscore',
  'masterypercentage',
  'completionpercentage',
  'completiontimestamp',
  'nextreviewdate',
  'reviewschedule',
  'studyhistory',
  'sessionhistory',
  'studysessions',
  'analytics',
  'streak',
  'personaldeadlines',
  'startedat',
  'endedat',
  'password',
  'token',
  'apikey',
  'secret',
  'flashcards',
  'submissionfile'
]);

const SECRET_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/,
  /github_pat_[a-zA-Z0-9_]{80,}/,
  /AIzaSy[a-zA-Z0-9_\-]{33}/,
  /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/i
];

function checkPrivacy(obj, path = '') {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(obj)) {
          return { valid: false, reason: `Exposed secret/token detected at "${path}".` };
        }
      }
    }
    return { valid: true };
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const res = checkPrivacy(obj[i], `${path}[${i}]`);
      if (!res.valid) return res;
    }
    return { valid: true };
  }

  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase().replace(/[^a-z]/g, '');
    const curPath = path ? `${path}.${key}` : key;

    if (STRICT_FORBIDDEN_KEYS.has(lower)) {
      return { valid: false, reason: `Forbidden private key detected: "${curPath}".` };
    }

    const childRes = checkPrivacy(obj[key], curPath);
    if (!childRes.valid) return childRes;
  }

  return { valid: true };
}

// 4. URL Security & SSRF Protection
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254',
  'instance-data',
  'metadata.google.internal'
]);

function isPrivateIp(hostname) {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;

  // Check IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
  const parts = hostname.split('.').map(Number);
  if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  return false;
}

function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    if (isPrivateIp(parsed.hostname)) {
      return null;
    }

    // Strip common marketing / tracking query parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref_src'];
    trackingParams.forEach(p => parsed.searchParams.delete(p));

    // Normalize YouTube URL formats
    if (parsed.hostname === 'youtu.be') {
      const videoId = parsed.pathname.replace(/^\//, '');
      parsed.hostname = 'www.youtube.com';
      parsed.pathname = '/watch';
      parsed.searchParams.set('v', videoId);
    }

    let clean = parsed.toString();
    if (clean.endsWith('/') && parsed.pathname !== '/') {
      clean = clean.slice(0, -1);
    }
    return clean;
  } catch {
    return null;
  }
}

// 5. Reachability Check with 7-second timeout
function checkUrlReachable(urlStr) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.request(urlStr, {
        method: 'HEAD',
        timeout: 7000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 DegreeTrack/1.0'
        }
      }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve({ status: 'ok', code: res.statusCode });
        } else if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) {
          // Cloudflare, bot blockers, or rate limits
          resolve({ status: 'review', code: res.statusCode, reason: `HTTP ${res.statusCode} (Automated access restricted by host)` });
        } else if (res.statusCode === 404) {
          resolve({ status: 'invalid', code: 404, reason: 'URL returned 404 Not Found' });
        } else {
          resolve({ status: 'review', code: res.statusCode, reason: `Server returned HTTP ${res.statusCode}` });
        }
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'review', reason: 'URL verification timed out (>7s)' });
      });

      req.on('error', (err) => {
        resolve({ status: 'review', reason: `Connection error: ${err.message}` });
      });

      req.end();
    } catch (e) {
      resolve({ status: 'invalid', reason: e.message });
    }
  });
}

// 6. Main Evaluation Function
async function evaluateSubmission() {
  const extracted = extractJsonPayload(issueBody);
  if (!extracted) {
    return {
      decision: 'rejected',
      reason: 'No valid JSON code block found in issue body.'
    };
  }

  const payload = extracted.payload || extracted;
  const submissionType = extracted.submissionType || (payload.course ? 'course' : (payload.resources ? 'batch' : 'resource'));

  // A. Privacy Check
  const privacyCheck = checkPrivacy(payload);
  if (!privacyCheck.valid) {
    return {
      decision: 'rejected',
      reason: `Privacy validation failed: ${privacyCheck.reason}`
    };
  }

  // B. Process according to type
  if (submissionType === 'resource') {
    const res = payload.resource || payload;
    const rawUrl = res.canonicalUrl || res.url;
    const title = res.title?.trim();

    if (!title || !rawUrl) {
      return { decision: 'rejected', reason: 'Missing resource title or URL.' };
    }

    const cleanUrl = normalizeUrl(rawUrl);
    if (!cleanUrl) {
      return { decision: 'rejected', reason: 'Invalid or prohibited URL protocol / private network address.' };
    }

    // Duplicate Check
    const resourcesIndex = loadJson(resourcesIndexPath, []);
    const isExactDuplicate = resourcesIndex.some(existing => normalizeUrl(existing.url) === cleanUrl);
    if (isExactDuplicate) {
      return { decision: 'rejected', reason: `Duplicate resource: A resource with URL "${cleanUrl}" already exists in the library.` };
    }

    // URL Reachability Check
    const reachability = await checkUrlReachable(cleanUrl);
    if (reachability.status === 'invalid') {
      return { decision: 'rejected', reason: `Resource URL is unreachable: ${reachability.reason}` };
    }

    if (reachability.status === 'review' && triggerType !== 'manual_approve') {
      return {
        decision: 'needs-review',
        reason: `Resource URL requires manual review: ${reachability.reason}`,
        resourceData: { title, url: cleanUrl, res }
      };
    }

    return {
      decision: 'auto-approved',
      type: 'resource',
      data: {
        title,
        url: cleanUrl,
        type: (res.type?.toLowerCase() || 'article'),
        role: res.role || res.scopeInstructions || 'PRIMARY',
        category: res.category || payload.context?.topics?.[0] || 'Community',
        description: res.description || 'Community resource submitted by learner.'
      }
    };

  } else if (submissionType === 'course') {
    const course = payload.course || payload;
    const courseTitle = course.title?.trim() || course.name?.trim();
    const modules = payload.modules || [];
    const topics = payload.topics || [];

    if (!courseTitle) {
      return { decision: 'rejected', reason: 'Missing course title.' };
    }

    // Duplicate Check
    const coursesIndex = loadJson(coursesIndexPath, []);
    const existingCourse = coursesIndex.find(c => c.title.toLowerCase().trim() === courseTitle.toLowerCase().trim());
    if (existingCourse) {
      return { decision: 'rejected', reason: `Duplicate course: A course with title "${courseTitle}" already exists in the community library.` };
    }

    // Validate modules & topics count
    if (modules.length === 0 && topics.length === 0) {
      return { decision: 'needs-review', reason: 'Course has no modules or topics defined.' };
    }

    return {
      decision: 'auto-approved',
      type: 'course',
      data: {
        title: courseTitle,
        description: course.description || 'Community course curriculum.',
        author: issueAuthor,
        moduleCount: modules.length,
        rawPayload: payload
      }
    };

  } else if (submissionType === 'batch') {
    const items = payload.resources || [];
    if (!Array.isArray(items) || items.length === 0) {
      return { decision: 'rejected', reason: 'Resource batch contains no items.' };
    }

    return {
      decision: 'needs-review',
      reason: `Resource batch containing ${items.length} items queued for maintainer review.`,
      type: 'batch'
    };
  }

  return { decision: 'rejected', reason: `Unknown submission type "${submissionType}".` };
}

// 7. Execution and Publishing
async function run() {
  const result = await evaluateSubmission();
  console.log(`[Moderator] Decision for #${issueNumber}: ${result.decision.toUpperCase()}`);

  const outputInfo = {
    decision: result.decision,
    reason: result.reason || ''
  };

  if (result.decision === 'auto-approved') {
    const manifest = loadJson(manifestPath, {
      schemaVersion: 1,
      libraryVersion: 1,
      updatedAt: new Date().toISOString(),
      courseCount: 0,
      resourceCount: 0
    });

    if (result.type === 'resource') {
      const item = result.data;
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 35) || 'res';
      const id = `res_${slug}_${Date.now().toString(36)}`;
      const fileName = `${id}.json`;

      // 1. Create full resource file
      const fullItem = {
        schemaVersion: 1,
        id,
        title: item.title,
        url: item.url,
        type: item.type,
        role: item.role,
        category: item.category,
        description: item.description,
        submittedAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString()
      };
      fs.writeFileSync(path.join(resourcesDir, fileName), JSON.stringify(fullItem, null, 2), 'utf8');

      // 2. Update community resources index
      const resourcesIndex = loadJson(resourcesIndexPath, []);
      resourcesIndex.unshift({
        id,
        title: item.title,
        url: item.url,
        type: item.type,
        role: item.role,
        category: item.category,
        file: `resources/${fileName}`
      });
      fs.writeFileSync(resourcesIndexPath, JSON.stringify(resourcesIndex, null, 2), 'utf8');

      // 3. Update legacy root resources.json for backward compatibility
      const legacyResources = loadJson(legacyResourcesPath, []);
      legacyResources.unshift({
        id,
        title: item.title,
        url: item.url,
        type: item.type,
        role: item.role,
        category: item.category,
        description: item.description
      });
      fs.writeFileSync(legacyResourcesPath, JSON.stringify(legacyResources, null, 2), 'utf8');

      // 4. Update manifest
      manifest.libraryVersion = (manifest.libraryVersion || 1) + 1;
      manifest.updatedAt = new Date().toISOString();
      manifest.resourceCount = resourcesIndex.length;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      outputInfo.publishedId = id;
      outputInfo.publishedTitle = item.title;

    } else if (result.type === 'course') {
      const item = result.data;
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 35) || 'course';
      const id = `course_${slug}_${Date.now().toString(36)}`;
      const fileName = `${id}.json`;

      // 1. Create course JSON file
      fs.writeFileSync(path.join(coursesDir, fileName), JSON.stringify(item.rawPayload, null, 2), 'utf8');

      // 2. Update community courses index
      const coursesIndex = loadJson(coursesIndexPath, []);
      coursesIndex.unshift({
        id,
        title: item.title,
        description: item.description,
        author: item.author,
        moduleCount: item.moduleCount,
        file: `courses/${fileName}`
      });
      fs.writeFileSync(coursesIndexPath, JSON.stringify(coursesIndex, null, 2), 'utf8');

      // 3. Update legacy root courses.json for backward compatibility
      const legacyCourses = loadJson(legacyCoursesPath, []);
      legacyCourses.unshift({
        id,
        title: item.title,
        author: item.author,
        description: item.description,
        filename: `community/courses/${fileName}`
      });
      fs.writeFileSync(legacyCoursesPath, JSON.stringify(legacyCourses, null, 2), 'utf8');

      // 4. Update manifest
      manifest.libraryVersion = (manifest.libraryVersion || 1) + 1;
      manifest.updatedAt = new Date().toISOString();
      manifest.courseCount = coursesIndex.length;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      outputInfo.publishedId = id;
      outputInfo.publishedTitle = item.title;
    }
  }

  // Write machine result to file for GitHub Actions to read
  fs.writeFileSync(path.join(rootDir, 'moderation-result.json'), JSON.stringify(outputInfo, null, 2), 'utf8');
  console.log('[Moderator] Completed evaluation. Result saved to moderation-result.json');
}

run().catch(err => {
  console.error('[Moderator] Fatal exception in moderation script:', err);
  process.exit(1);
});
