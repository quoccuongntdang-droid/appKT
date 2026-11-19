const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const DEFAULT_MONGO_URI = "mongodb+srv://quoccuongdn96vn_db_user:Cuong123@cluster0.rjqeg1h.mongodb.net/bible_lms?retryWrites=true&w=majority";
const MONGO_URI = process.env.MONGO_URI || DEFAULT_MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Đã kết nối MongoDB thành công (DB: bible_lms)!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err.message));

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

const studentUserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    unlockedTopic: { type: Number, default: 1, min: 1, max: 5 },
    unlockedByTopic: {
        type: Map,
        of: Number,
        default: () => ({ "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 })
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
    date: { type: String, default: () => new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) }
}, { timestamps: true });

const BibleQuizResult = mongoose.model('BibleQuizResult', bibleQuizResultSchema);

function normalizeProgress(userDoc) {
    const mapObj = userDoc.unlockedByTopic instanceof Map
        ? Object.fromEntries(userDoc.unlockedByTopic)
        : (userDoc.unlockedByTopic || {});

    const progress = {
        "1": Math.min(10, Math.max(1, Number(mapObj["1"] ?? 1))),
        "2": Math.min(10, Math.max(0, Number(mapObj["2"] ?? 0))),
        "3": Math.min(10, Math.max(0, Number(mapObj["3"] ?? 0))),
        "4": Math.min(10, Math.max(0, Number(mapObj["4"] ?? 0))),
        "5": Math.min(10, Math.max(0, Number(mapObj["5"] ?? 0)))
    };

    let unlockedTopic = Number(userDoc.unlockedTopic || 1);
    for (let t = 1; t < unlockedTopic; t++) {
        progress[String(t)] = 10;
    }
    if (progress[String(unlockedTopic)] === 0) {
        progress[String(unlockedTopic)] = 1;
    }

    return { unlockedTopic, unlockedByTopic: progress };
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
            unlockedByTopic: { "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 }
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
        const clampedLessons = Math.min(totalLessonsInTopic, Math.max(prog.unlockedByTopic[key] || 1, unlockedLessonsInTopic));
        prog.unlockedByTopic[key] = clampedLessons;

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
        }

        user.unlockedTopic = prog.unlockedTopic;
        user.unlockedByTopic = prog.unlockedByTopic;
        await user.save();

        return res.json({
            success: true,
            nextTopicUnlocked,
            student: { username: user.username, ...prog }
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
        return res.json({ success: true, message: 'Đăng nhập Admin thành công!' });
    }
    return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu quản trị!' });
});

app.post('/api/submit-quiz', async (req, res) => {
    try {
        const studentName = String(req.body?.studentName || '').trim();
        const topicId = Number(req.body?.topicId);
        const quizType = Number(req.body?.quizType);
        const lessonTitle = String(req.body?.lessonTitle || '').trim();
        const score = Number(req.body?.score);
        const total = Number(req.body?.total);
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
            ...(date ? { date } : {})
        });

        await record.save();
        console.log(`📝 Đã lưu điểm của ${studentName} (Chủ đề ${topicId}, KT ${quizType}): ${score}/${total}`);
        return res.json({ success: true, message: 'Đã lưu kết quả vào MongoDB thành công!' });
    } catch (err) {
        console.error('Lỗi lưu kết quả MongoDB:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lưu kết quả lên cơ sở dữ liệu!' });
    }
});

app.get('/api/admin/results', async (req, res) => {
    try {
        const results = await BibleQuizResult.find().sort({ createdAt: -1 }).limit(200);
        return res.json(results);
    } catch (err) {
        console.error('Lỗi đọc kết quả MongoDB:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lấy dữ liệu từ MongoDB!' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại cổng ${PORT}`);
});
