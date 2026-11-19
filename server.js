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

// lessonsByTopic: { "1": [0, 1], "2": [], ... } -> mảng chỉ số 0-based các bài đang được mở khóa trong từng chủ đề
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

// Hỗ trợ mọi đường dẫn SPA để thanh địa chỉ điều hướng trực tiếp hoạt động khi reload
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
    '/quiz'
];

app.get(spaRoutes, (req, res) => {
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
            unlockedByTopic: { "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 },
            lessonsByTopic: { "1": [0], "2": [], "3": [], "4": [], "5": [] }
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

// Học viên mở khóa tuần tự bài tiếp theo / chủ đề tiếp theo
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

// Admin lưu danh sách các bài được tick mở/khóa trong từng chủ đề cho học viên
app.post('/api/admin/set-checked-lessons', async (req, res) => {
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

app.get('/api/admin/results', async (req, res) => {
    try {
        const results = await BibleQuizResult.find().sort({ createdAt: -1 }).limit(200);
        return res.json(results);
    } catch (err) {
        console.error('Lỗi đọc kết quả MongoDB:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lấy dữ liệu từ MongoDB!' });
    }
});

app.post('/api/admin/delete-result', async (req, res) => {
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

// Admin xóa nhiều dòng kết quả kiểm tra theo danh sách ID
app.post('/api/admin/delete-results-bulk', async (req, res) => {
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

app.post('/api/admin/reset-results', async (req, res) => {
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

app.get('/api/admin/students', async (req, res) => {
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

app.post('/api/admin/set-progress', async (req, res) => {
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

app.post('/api/admin/delete-student', async (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại cổng ${PORT}`);
});
