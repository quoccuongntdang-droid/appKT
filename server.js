const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(__dirname));

const DEFAULT_MONGO_URI = "mongodb+srv://quoccuongdn96vn_db_user:Cuong123@cluster0.rjqeg1h.mongodb.net/bible_lms?retryWrites=true&w=majority";
const MONGO_URI = process.env.MONGO_URI || DEFAULT_MONGO_URI;

const DIAGRAM_DIR = path.join(__dirname, 'diagram');
const DIAGRAM_JSON_PATH = path.join(__dirname, 'diagram_v2.json');

function ensureDiagramStorage() {
    if (!fs.existsSync(DIAGRAM_DIR)) {
        fs.mkdirSync(DIAGRAM_DIR, { recursive: true });
    }
    if (!fs.existsSync(DIAGRAM_JSON_PATH)) {
        fs.writeFileSync(DIAGRAM_JSON_PATH, '{}\n', 'utf8');
    }
}

function readDiagramMap() {
    ensureDiagramStorage();
    try {
        const raw = fs.readFileSync(DIAGRAM_JSON_PATH, 'utf8').trim();
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
        return {};
    }
}

function writeDiagramMap(mapObj) {
    ensureDiagramStorage();
    fs.writeFileSync(DIAGRAM_JSON_PATH, JSON.stringify(mapObj, null, 2), 'utf8');
}

function buildDiagramKey(topicId, lessonCode) {
    const t = Number(topicId || 1);
    const code = String(lessonCode || '1-1').trim();
    return `${t}:${code}`;
}

function getSafeImageExt(mimeOrName) {
    const s = String(mimeOrName || '').toLowerCase();
    if (s.includes('png')) return '.png';
    if (s.includes('webp')) return '.webp';
    if (s.includes('gif')) return '.gif';
    if (s.includes('jpeg') || s.includes('jpg')) return '.jpg';
    return '.png';
}

async function upsertFileToGitHub({ repoPath, base64Content, commitMessage }) {
    const token = String(process.env.GITHUB_TOKEN || '').trim();
    const repo = String(process.env.GITHUB_REPO || '').trim();
    const branch = String(process.env.GITHUB_BRANCH || 'main').trim() || 'main';

    if (!token || !repo) {
        return { synced: false, reason: 'Chưa cấu hình GITHUB_TOKEN hoặc GITHUB_REPO' };
    }

    const encodedPath = repoPath
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');

    const apiBase = `https://api.github.com/repos/${repo}/contents/${encodedPath}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'bible-lms-v2-sync'
    };

    let existingSha = undefined;
    const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });
    if (getRes.ok) {
        const getJson = await getRes.json();
        if (getJson && getJson.sha) {
            existingSha = getJson.sha;
        }
    }

    const putRes = await fetch(apiBase, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
            message: commitMessage,
            content: base64Content,
            branch,
            ...(existingSha ? { sha: existingSha } : {})
        })
    });

    if (!putRes.ok) {
        const errText = await putRes.text();
        throw new Error(`GitHub API ${putRes.status}: ${errText}`);
    }

    return { synced: true };
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Đã kết nối MongoDB thành công (DB: bible_lms)!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err.message));

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

const ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const adminSessions = new Map();

function issueAdminToken() {
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
    return token;
}

function isValidAdminToken(token) {
    if (!token) return false;
    const expiresAt = adminSessions.get(token);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
        adminSessions.delete(token);
        return false;
    }
    return true;
}

function requireAdmin(req, res, next) {
    const authHeader = String(req.headers?.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!isValidAdminToken(token)) {
        return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Phiên Admin không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại!' });
    }
    return next();
}

const studentUserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    unlockedTopic: { type: Number, default: 1, min: 1, max: 5 },
    unlockedByTopic: {
        type: Map,
        of: Number,
        default: () => ({ "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 })
    },
    lessonsByTopic: {
        type: Map,
        of: [Number],
        default: () => ({ "1": [0], "2": [], "3": [], "4": [], "5": [] })
    },
    unlockedSections: {
        type: Map,
        of: [String],
        default: () => ({ "1-1": ["1-1-sec-1"] })
    }
}, { timestamps: true });

const StudentUser = mongoose.model('StudentUser', studentUserSchema);

const bibleQuizResultSchema = new mongoose.Schema({
    studentName: { type: String, required: true, trim: true },
    topicId: { type: Number, required: true },
    quizType: { type: Number, required: true },
    lessonTitle: { type: String, default: '' },
    score: { type: Number, required: true },
    total: { type: Number, required: true },
    statusText: { type: String, default: '' },
    date: { type: String, default: () => new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) }
}, { timestamps: true });

const BibleQuizResult = mongoose.model('BibleQuizResult', bibleQuizResultSchema);

function normalizeProgress(userDoc) {
    const mapObj = userDoc.unlockedByTopic instanceof Map
        ? Object.fromEntries(userDoc.unlockedByTopic)
        : (userDoc.unlockedByTopic || {});

    const lessonsMapRaw = userDoc.lessonsByTopic instanceof Map
        ? Object.fromEntries(userDoc.lessonsByTopic)
        : (userDoc.lessonsByTopic || {});

    const lessonsByTopic = {};
    for (let t = 1; t <= 5; t++) {
        const key = String(t);
        const arr = Array.isArray(lessonsMapRaw[key])
            ? [...new Set(lessonsMapRaw[key].map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 10))].sort((a, b) => a - b)
            : null;

        if (arr !== null) {
            lessonsByTopic[key] = arr;
        } else {
            const countFromLegacy = Math.min(10, Math.max(0, Number(mapObj[key] ?? (t === 1 ? 1 : 0))));
            lessonsByTopic[key] = Array.from({ length: countFromLegacy }, (_, idx) => idx);
        }
    }

    if (!lessonsByTopic["1"].length) {
        lessonsByTopic["1"] = [0];
    }

    const progress = {};
    for (let t = 1; t <= 5; t++) {
        const key = String(t);
        progress[key] = Math.max(Number(mapObj[key] ?? 0), lessonsByTopic[key].length);
    }

    let unlockedTopic = Math.min(5, Math.max(1, Number(userDoc.unlockedTopic || 1)));
    for (let t = 1; t < unlockedTopic; t++) {
        const key = String(t);
        if (lessonsByTopic[key].length < 10) {
            lessonsByTopic[key] = Array.from({ length: 10 }, (_, idx) => idx);
        }
        progress[key] = 10;
    }

    return { unlockedTopic, unlockedByTopic: progress, lessonsByTopic };
}

function normalizeUnlockedSections(userDoc) {
    const rawMap = userDoc.unlockedSections instanceof Map
        ? Object.fromEntries(userDoc.unlockedSections)
        : (userDoc.unlockedSections || {});
    const result = {};
    for (const [lessonCode, secList] of Object.entries(rawMap)) {
        const key = String(lessonCode || '').trim();
        if (!key) continue;
        const clean = Array.isArray(secList)
            ? [...new Set(secList.map(s => String(s || '').trim()).filter(Boolean))]
            : [];
        result[key] = clean;
    }
    if (!Array.isArray(result['1-1']) || !result['1-1'].length) {
        result['1-1'] = ['1-1-sec-1'];
    }
    return result;
}

const spaRoutes = [
    '/',
    '/login',
    '/register',
    '/admin/login',
    '/admin/dashboard',
    '/topics',
    '/modes',
    '/quiz/select-lesson',
    '/flashcard',
    '/quiz',
    '/study-v2',
    '/admin-v2',
    '/read-v2',
    '/summary-v2',
    '/verses-v2'
];

app.get(spaRoutes, (req, res) => {
    if (req.path === '/read-v2') {
        const readV2Path = path.join(__dirname, 'read_v2.html');
        if (fs.existsSync(readV2Path)) {
            return res.sendFile(readV2Path);
        }
    }
    if (req.path === '/summary-v2') {
        const sumV2Path = path.join(__dirname, 'summary_v2.html');
        if (fs.existsSync(sumV2Path)) {
            return res.sendFile(sumV2Path);
        }
    }
    if (req.path === '/verses-v2') {
        const verV2Path = path.join(__dirname, 'verses_v2.html');
        if (fs.existsSync(verV2Path)) {
            return res.sendFile(verV2Path);
        }
    }
    if (req.path === '/study-v2') {
        const v2Path = path.join(__dirname, 'study_v2.html');
        if (fs.existsSync(v2Path)) {
            return res.sendFile(v2Path);
        }
    }
    if (req.path === '/admin-v2') {
        const adminV2Path = path.join(__dirname, 'admin_v2.html');
        if (fs.existsSync(adminV2Path)) {
            return res.sendFile(adminV2Path);
        }
    }
    return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/v2/stage1-lesson1', (req, res) => {
    try {
        const contentPath = path.join(__dirname, 'stage1_lesson1_content.json');
        const quizPath = path.join(__dirname, 'stage1_lesson1_quiz.json');

        if (!fs.existsSync(contentPath) || !fs.existsSync(quizPath)) {
            return res.status(404).json({
                success: false,
                message: 'Thiếu file stage1_lesson1_content.json hoặc stage1_lesson1_quiz.json'
            });
        }

        const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
        const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
        return res.json({ success: true, content, quiz });
    } catch (err) {
        console.error('Lỗi đọc dữ liệu v2:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi đọc file JSON Bài 1.1!' });
    }
});

app.get('/api/v2/diagram', (req, res) => {
    try {
        const topicId = Number(req.query?.topic || 1);
        const lessonCode = String(req.query?.lesson || '1-1').trim();
        const key = buildDiagramKey(topicId, lessonCode);
        const map = readDiagramMap();
        const entry = map[key] || map[lessonCode] || null;

        return res.json({
            success: true,
            key,
            topicId,
            lessonCode,
            diagram: entry || {
                key,
                topicId,
                lessonCode,
                imageUrl: '',
                caption: ''
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Lỗi đọc dữ liệu sơ đồ!' });
    }
});

app.get('/api/v2/diagram/:lessonCode', (req, res) => {
    try {
        const lessonCode = String(req.params?.lessonCode || '1-1').trim();
        const topicId = Number(req.query?.topic || lessonCode.split('-')[0] || 1);
        const key = buildDiagramKey(topicId, lessonCode);
        const map = readDiagramMap();
        const entry = map[key] || map[lessonCode] || null;

        return res.json({
            success: true,
            key,
            topicId,
            lessonCode,
            diagram: entry || {
                key,
                topicId,
                lessonCode,
                imageUrl: '',
                caption: ''
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Lỗi đọc cấu hình sơ đồ!' });
    }
});

app.post('/api/admin/v2/upload-diagram', requireAdmin, async (req, res) => {
    try {
        const topicId = Number(req.body?.topicId || 1);
        const lessonCode = String(req.body?.lessonCode || '1-1').trim();
        const caption = String(req.body?.caption || '').trim();
        const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
        const fileNameHint = String(req.body?.fileName || '').trim();

        if (!topicId || !lessonCode) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin chủ đề hoặc bài học!' });
        }

        ensureDiagramStorage();
        const map = readDiagramMap();
        const key = buildDiagramKey(topicId, lessonCode);
        const prevEntry = map[key] || {};
        let finalImageUrl = String(prevEntry.imageUrl || '').trim();

        let uploadedFileName = '';
        let imageBuffer = null;

        if (imageDataUrl) {
            const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
            if (!match) {
                return res.status(400).json({ success: false, message: 'Định dạng ảnh upload không hợp lệ!' });
            }
            const mimeType = match[1];
            const base64Body = match[2];
            const ext = getSafeImageExt(fileNameHint || mimeType);
            const cleanCode = lessonCode.replace(/[^a-zA-Z0-9_-]/g, '-');
            uploadedFileName = `topic${topicId}_lesson${cleanCode}${ext}`;
            const fullFilePath = path.join(DIAGRAM_DIR, uploadedFileName);

            imageBuffer = Buffer.from(base64Body, 'base64');
            fs.writeFileSync(fullFilePath, imageBuffer);
            finalImageUrl = `/diagram/${uploadedFileName}?v=${Date.now()}`;
        }

        const updatedItem = {
            key,
            topicId,
            lessonCode,
            imageUrl: finalImageUrl,
            caption,
            updatedAt: new Date().toISOString()
        };

        map[key] = updatedItem;
        const jsonString = JSON.stringify(map, null, 2);
        writeDiagramMap(map);

        let githubStatusText = ' (chỉ lưu local/Render tạm vì chưa cấu hình GitHub)';
        try {
            if (imageBuffer && uploadedFileName) {
                const imgSync = await upsertFileToGitHub({
                    repoPath: `diagram/${uploadedFileName}`,
                    base64Content: imageBuffer.toString('base64'),
                    commitMessage: `Update diagram image for topic ${topicId} lesson ${lessonCode}`
                });
                if (imgSync.synced) {
                    const jsonSync = await upsertFileToGitHub({
                        repoPath: 'diagram_v2.json',
                        base64Content: Buffer.from(jsonString, 'utf8').toString('base64'),
                        commitMessage: `Update diagram_v2.json for topic ${topicId} lesson ${lessonCode}`
                    });
                    githubStatusText = jsonSync.synced
                        ? ' & đã đẩy đồng bộ lên GitHub!'
                        : ` (${jsonSync.reason})`;
                } else {
                    githubStatusText = ` (${imgSync.reason})`;
                }
            } else {
                const jsonSync = await upsertFileToGitHub({
                    repoPath: 'diagram_v2.json',
                    base64Content: Buffer.from(jsonString, 'utf8').toString('base64'),
                    commitMessage: `Update diagram caption for topic ${topicId} lesson ${lessonCode}`
                });
                githubStatusText = jsonSync.synced
                    ? ' & đã cập nhật caption lên GitHub!'
                    : ` (${jsonSync.reason})`;
            }
        } catch (ghErr) {
            console.error('Lỗi đồng bộ GitHub:', ghErr.message);
            githubStatusText = ` (lưu local OK, nhưng đồng bộ GitHub lỗi: ${ghErr.message})`;
        }

        return res.json({
            success: true,
            message: `Đã lưu sơ đồ cho Chủ đề ${topicId} — Bài ${lessonCode}${githubStatusText}`,
            diagram: updatedItem
        });
    } catch (err) {
        console.error('Lỗi upload sơ đồ V2:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lưu ảnh sơ đồ lên máy chủ!' });
    }
});

app.get('/api/v2/progress/:username/:lessonCode', async (req, res) => {
    try {
        const username = String(req.params?.username || '').trim().toLowerCase();
        const lessonCode = String(req.params?.lessonCode || '1-1').trim();
        const user = await StudentUser.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản học viên!' });
        }
        const map = normalizeUnlockedSections(user);
        return res.json({
            success: true,
            username: user.username,
            lessonCode,
            unlockedSectionIds: map[lessonCode] || []
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Lỗi lấy tiến độ phần v2!' });
    }
});

app.post('/api/student/register', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const password = String(req.body?.password || '');

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ tên tài khoản và mật khẩu!' });
        }
        if (password.length < 4) {
            return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 4 ký tự!' });
        }

        const existed = await StudentUser.findOne({ username });
        if (existed) {
            return res.status(409).json({ success: false, message: 'Tên tài khoản này đã tồn tại!' });
        }

        const newUser = new StudentUser({
            username,
            passwordHash: hashPassword(password),
            unlockedTopic: 1,
            unlockedByTopic: { "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 },
            lessonsByTopic: { "1": [0], "2": [], "3": [], "4": [], "5": [] },
            unlockedSections: { "1-1": ["1-1-sec-1"] }
        });
        await newUser.save();

        const prog = normalizeProgress(newUser);
        return res.json({
            success: true,
            message: 'Đăng ký tài khoản thành công!',
            student: { username: newUser.username, ...prog }
        });
    } catch (err) {
        console.error('Lỗi đăng ký học viên:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đăng ký!' });
    }
});

app.post('/api/student/login', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const password = String(req.body?.password || '');

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên tài khoản và mật khẩu!' });
        }

        const user = await StudentUser.findOne({ username });
        if (!user || user.passwordHash !== hashPassword(password)) {
            return res.status(401).json({ success: false, message: 'Sai tên tài khoản hoặc mật khẩu!' });
        }

        const prog = normalizeProgress(user);
        return res.json({
            success: true,
            message: 'Đăng nhập thành công!',
            student: { username: user.username, ...prog }
        });
    } catch (err) {
        console.error('Lỗi đăng nhập học viên:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đăng nhập!' });
    }
});

app.get('/api/student/progress/:username', async (req, res) => {
    try {
        const username = String(req.params?.username || '').trim().toLowerCase();
        const user = await StudentUser.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại!' });
        }
        const prog = normalizeProgress(user);
        return res.json({ success: true, student: { username: user.username, ...prog } });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Lỗi lấy tiến độ học viên!' });
    }
});

app.post('/api/student/progress', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const topicId = Number(req.body?.topicId);
        const unlockedLessonsInTopic = Number(req.body?.unlockedLessonsInTopic);
        const totalLessonsInTopic = Number(req.body?.totalLessonsInTopic || 10);

        if (!username || !topicId) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin tiến độ!' });
        }

        const user = await StudentUser.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản học viên!' });
        }

        const prog = normalizeProgress(user);
        const key = String(topicId);
        const clampedLessons = Math.min(totalLessonsInTopic, Math.max(prog.unlockedByTopic[key] || 0, unlockedLessonsInTopic));
        prog.unlockedByTopic[key] = clampedLessons;

        const existingSet = new Set(prog.lessonsByTopic[key] || []);
        for (let i = 0; i < clampedLessons; i++) {
            existingSet.add(i);
        }
        prog.lessonsByTopic[key] = [...existingSet].sort((a, b) => a - b);

        let nextTopicUnlocked = false;
        if (clampedLessons >= totalLessonsInTopic && topicId < 5) {
            const nextKey = String(topicId + 1);
            if (prog.unlockedTopic < topicId + 1) {
                prog.unlockedTopic = topicId + 1;
                nextTopicUnlocked = true;
            }
            if ((prog.unlockedByTopic[nextKey] || 0) < 1) {
                prog.unlockedByTopic[nextKey] = 1;
            }
            if (!prog.lessonsByTopic[nextKey].includes(0)) {
                prog.lessonsByTopic[nextKey].push(0);
                prog.lessonsByTopic[nextKey].sort((a, b) => a - b);
            }
        }

        user.unlockedTopic = prog.unlockedTopic;
        user.unlockedByTopic = prog.unlockedByTopic;
        user.lessonsByTopic = prog.lessonsByTopic;
        await user.save();

        const updatedProg = normalizeProgress(user);
        return res.json({
            success: true,
            nextTopicUnlocked,
            student: { username: user.username, ...updatedProg }
        });
    } catch (err) {
        console.error('Lỗi cập nhật tiến độ:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lưu tiến độ học tập!' });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const ADMIN_USER = process.env.ADMIN_USER || "admin";
    const ADMIN_PASS = process.env.ADMIN_PASS || "cuong123";

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = issueAdminToken();
        return res.json({
            success: true,
            token,
            expiresInMs: ADMIN_TOKEN_TTL_MS,
            message: 'Đăng nhập Admin thành công!'
        });
    }
    return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu quản trị!' });
});

app.get('/api/admin/verify', requireAdmin, (req, res) => {
    return res.json({ success: true, valid: true });
});

app.post('/api/admin/logout', (req, res) => {
    const authHeader = String(req.headers?.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) adminSessions.delete(token);
    return res.json({ success: true, message: 'Đã đăng xuất Admin!' });
});

app.post('/api/submit-quiz', async (req, res) => {
    try {
        const studentName = String(req.body?.studentName || '').trim();
        const topicId = Number(req.body?.topicId);
        const quizType = Number(req.body?.quizType);
        const lessonTitle = String(req.body?.lessonTitle || '').trim();
        const score = Number(req.body?.score);
        const total = Number(req.body?.total);
        const statusText = String(req.body?.statusText || '').trim();
        const date = req.body?.date;

        if (!studentName || !Number.isFinite(topicId) || !Number.isFinite(quizType) || !Number.isFinite(score) || !Number.isFinite(total)) {
            return res.status(400).json({ success: false, message: 'Thiếu hoặc sai định dạng dữ liệu bài kiểm tra!' });
        }

        const record = new BibleQuizResult({
            studentName,
            topicId,
            quizType,
            lessonTitle,
            score,
            total,
            statusText,
            ...(date ? { date } : {})
        });

        await record.save();
        console.log(`📝 Đã lưu điểm của ${studentName} (Chủ đề ${topicId}, KT ${quizType}): ${score}/${total} ${statusText}`);
        return res.json({ success: true, message: 'Đã lưu kết quả vào MongoDB thành công!' });
    } catch (err) {
        console.error('Lỗi lưu kết quả MongoDB:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lưu kết quả lên cơ sở dữ liệu!' });
    }
});

app.get('/api/admin/results', requireAdmin, async (req, res) => {
    try {
        const results = await BibleQuizResult.find().sort({ createdAt: -1 }).limit(200);
        return res.json(results);
    } catch (err) {
        console.error('Lỗi đọc kết quả MongoDB:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lấy dữ liệu từ MongoDB!' });
    }
});

app.post('/api/admin/delete-result', requireAdmin, async (req, res) => {
    try {
        const id = String(req.body?.id || '').trim();
        if (!id) {
            return res.status(400).json({ success: false, message: 'Thiếu ID bản ghi điểm!' });
        }
        const deleted = await BibleQuizResult.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi điểm này!' });
        }
        return res.json({ success: true, message: 'Đã xóa dòng kết quả!' });
    } catch (err) {
        console.error('Lỗi xóa dòng điểm:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi khi xóa dòng kết quả!' });
    }
});

app.post('/api/admin/delete-results-bulk', requireAdmin, async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids)
            ? req.body.ids.map(x => String(x || '').trim()).filter(Boolean)
            : [];
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'Chưa chọn dòng kết quả nào để xóa!' });
        }
        const deleted = await BibleQuizResult.deleteMany({ _id: { $in: ids } });
        return res.json({
            success: true,
            deletedCount: deleted.deletedCount,
            message: `Đã xóa ${deleted.deletedCount} kết quả kiểm tra đã chọn.`
        });
    } catch (err) {
        console.error('Lỗi xóa nhiều dòng điểm:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi khi xóa các dòng kết quả!' });
    }
});

app.post('/api/admin/reset-results', requireAdmin, async (req, res) => {
    try {
        const studentName = String(req.body?.studentName || '').trim().toLowerCase();
        const filter = studentName ? { studentName } : {};
        const deleted = await BibleQuizResult.deleteMany(filter);
        return res.json({
            success: true,
            deletedCount: deleted.deletedCount,
            message: studentName
                ? `Đã xóa ${deleted.deletedCount} kết quả của học viên "${studentName}".`
                : `Đã reset toàn bộ ${deleted.deletedCount} kết quả kiểm tra.`
        });
    } catch (err) {
        console.error('Lỗi reset kết quả:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi khi reset kết quả kiểm tra!' });
    }
});

app.get('/api/admin/students', requireAdmin, async (req, res) => {
    try {
        const users = await StudentUser.find().sort({ createdAt: -1 });
        const list = users.map(u => ({
            username: u.username,
            ...normalizeProgress(u),
            createdAt: u.createdAt
        }));
        return res.json(list);
    } catch (err) {
        console.error('Lỗi lấy danh sách học viên:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách học viên!' });
    }
});

app.post('/api/admin/set-checked-lessons', requireAdmin, async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const topicId = Number(req.body?.topicId);
        const checkedIndexes = Array.isArray(req.body?.checkedIndexes) ? req.body.checkedIndexes : [];

        if (!username || !topicId || topicId < 1 || topicId > 5) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin học viên hoặc chủ đề!' });
        }

        const user = await StudentUser.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy học viên!' });
        }

        const prog = normalizeProgress(user);
        const key = String(topicId);
        const cleanArr = [...new Set(checkedIndexes.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 10))].sort((a, b) => a - b);

        prog.lessonsByTopic[key] = cleanArr;
        prog.unlockedByTopic[key] = cleanArr.length;

        if (cleanArr.length >= 10 && topicId < 5 && prog.unlockedTopic < topicId + 1) {
            prog.unlockedTopic = topicId + 1;
            const nextKey = String(topicId + 1);
            if (!prog.lessonsByTopic[nextKey].length) {
                prog.lessonsByTopic[nextKey] = [0];
            }
            prog.unlockedByTopic[nextKey] = Math.max(prog.unlockedByTopic[nextKey] || 0, prog.lessonsByTopic[nextKey].length);
        }

        user.unlockedTopic = prog.unlockedTopic;
        user.unlockedByTopic = prog.unlockedByTopic;
        user.lessonsByTopic = prog.lessonsByTopic;
        await user.save();

        const finalProg = normalizeProgress(user);
        return res.json({
            success: true,
            message: `Đã lưu ${cleanArr.length} bài được mở khóa ở Chủ Đề ${topicId} cho "${username}".`,
            student: { username: user.username, ...finalProg }
        });
    } catch (err) {
        console.error('Lỗi lưu danh sách bài tick:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lưu danh sách bài mở/khóa!' });
    }
});

app.post('/api/admin/set-progress', requireAdmin, async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const actionType = String(req.body?.actionType || 'custom');
        const targetTopic = Number(req.body?.targetTopic || 1);
        const targetLessons = Number(req.body?.targetLessons ?? 1);

        const user = await StudentUser.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy học viên!' });
        }

        let unlockedTopic = 1;
        let unlockedByTopic = { "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 };
        let lessonsByTopic = { "1": [0], "2": [], "3": [], "4": [], "5": [] };

        if (actionType === 'reset_lock_all') {
            unlockedTopic = 1;
            unlockedByTopic = { "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 };
            lessonsByTopic = { "1": [0], "2": [], "3": [], "4": [], "5": [] };
        } else if (actionType === 'unlock_all') {
            unlockedTopic = 5;
            const full10 = Array.from({ length: 10 }, (_, idx) => idx);
            unlockedByTopic = { "1": 10, "2": 10, "3": 10, "4": 10, "5": 10 };
            lessonsByTopic = { "1": [...full10], "2": [...full10], "3": [...full10], "4": [...full10], "5": [...full10] };
        } else {
            const t = Math.min(5, Math.max(1, targetTopic));
            const l = Math.min(10, Math.max(0, targetLessons));
            unlockedTopic = t;
            for (let i = 1; i <= 5; i++) {
                const key = String(i);
                if (i < t) {
                    unlockedByTopic[key] = 10;
                    lessonsByTopic[key] = Array.from({ length: 10 }, (_, idx) => idx);
                } else if (i === t) {
                    const count = Math.max(1, l);
                    unlockedByTopic[key] = count;
                    lessonsByTopic[key] = Array.from({ length: count }, (_, idx) => idx);
                } else {
                    unlockedByTopic[key] = 0;
                    lessonsByTopic[key] = [];
                }
            }
        }

        user.unlockedTopic = unlockedTopic;
        user.unlockedByTopic = unlockedByTopic;
        user.lessonsByTopic = lessonsByTopic;
        await user.save();

        const prog = normalizeProgress(user);
        return res.json({
            success: true,
            message: `Đã cập nhật tiến độ mở khóa cho "${username}"!`,
            student: { username: user.username, ...prog }
        });
    } catch (err) {
        console.error('Lỗi cập nhật tiến độ bởi Admin:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi cập nhật tiến độ học viên!' });
    }
});

app.post('/api/admin/delete-student', requireAdmin, async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const deleteResults = Boolean(req.body?.deleteResults);

        if (!username) {
            return res.status(400).json({ success: false, message: 'Thiếu tên tài khoản cần xóa!' });
        }

        const deletedUser = await StudentUser.findOneAndDelete({ username });
        if (!deletedUser) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản này!' });
        }

        let deletedResultsCount = 0;
        if (deleteResults) {
            const r = await BibleQuizResult.deleteMany({ studentName: username });
            deletedResultsCount = r.deletedCount;
        }

        return res.json({
            success: true,
            message: `Đã xóa tài khoản "${username}"${deleteResults ? ` và ${deletedResultsCount} kết quả kiểm tra` : ''}.`
        });
    } catch (err) {
        console.error('Lỗi xóa tài khoản học viên:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi khi xóa tài khoản học viên!' });
    }
});

app.get('/api/admin/v2/students', requireAdmin, async (req, res) => {
    try {
        const users = await StudentUser.find().sort({ createdAt: -1 });
        const list = users.map(u => ({
            username: u.username,
            unlockedSections: normalizeUnlockedSections(u),
            createdAt: u.createdAt
        }));
        return res.json({ success: true, students: list });
    } catch (err) {
        console.error('Lỗi lấy danh sách học viên v2:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách học viên v2!' });
    }
});

app.post('/api/admin/v2/set-sections', requireAdmin, async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const lessonCode = String(req.body?.lessonCode || '1-1').trim();
        const checkedSectionIds = Array.isArray(req.body?.checkedSectionIds)
            ? [...new Set(req.body.checkedSectionIds.map(s => String(s || '').trim()).filter(Boolean))]
            : [];

        if (!username || !lessonCode) {
            return res.status(400).json({ success: false, message: 'Thiếu tên học viên hoặc mã bài!' });
        }

        const user = await StudentUser.findOne({ username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy học viên!' });
        }

        const currentMap = normalizeUnlockedSections(user);
        currentMap[lessonCode] = checkedSectionIds;

        user.unlockedSections = currentMap;
        await user.save();

        return res.json({
            success: true,
            message: `Đã lưu ${checkedSectionIds.length} phần mở khóa cho "${username}" (Bài ${lessonCode}).`,
            username: user.username,
            unlockedSections: normalizeUnlockedSections(user)
        });
    } catch (err) {
        console.error('Lỗi lưu danh sách phần v2:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lưu danh sách phần mở khóa!' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại cổng ${PORT}`);
});
