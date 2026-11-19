const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// Chuỗi kết nối MongoDB Atlas (đặt trong Environment của Render với tên biến MONGO_URI)
// Mẹo: Nếu dùng chung cluster với chiến dịch 60 ngày, đổi tên DB sau dấu '/' thành bible_lms cho gọn
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.warn('⚠️ Chưa cấu hình biến môi trường MONGO_URI!');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ Đã kết nối MongoDB thành công!'))
        .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err.message));
}

// Schema lưu kết quả kiểm tra của học viên
const bibleQuizResultSchema = new mongoose.Schema({
    studentName: { type: String, required: true, trim: true },
    topicId: { type: Number, required: true },
    quizType: { type: Number, required: true },
    score: { type: Number, required: true },
    total: { type: Number, required: true },
    date: { type: String, default: () => new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) }
}, { timestamps: true });

const BibleQuizResult = mongoose.model('BibleQuizResult', bibleQuizResultSchema);

// Trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API Đăng nhập Admin
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const ADMIN_USER = process.env.ADMIN_USER || "admin";
    const ADMIN_PASS = process.env.ADMIN_PASS || "cuong123";

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        return res.json({ success: true, message: 'Đăng nhập Admin thành công!' });
    }
    return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu quản trị!' });
});

// API Nhận kết quả Quiz từ học viên và lưu vào MongoDB
app.post('/api/submit-quiz', async (req, res) => {
    try {
        const { studentName, topicId, quizType, score, total, date } = req.body || {};

        if (!studentName || score === undefined) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin học viên hoặc điểm số!' });
        }

        const record = new BibleQuizResult({
            studentName: String(studentName).trim(),
            topicId,
            quizType,
            score,
            total,
            ...(date ? { date } : {})
        });

        await record.save();
        return res.json({ success: true, message: 'Đã lưu kết quả vào MongoDB thành công!' });
    } catch (err) {
        console.error('Lỗi lưu kết quả MongoDB:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi lưu kết quả lên cơ sở dữ liệu!' });
    }
});

// API Cho Admin xem danh sách kết quả từ MongoDB
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
