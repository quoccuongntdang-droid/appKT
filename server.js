const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

// 1. Phục vụ toàn bộ file tĩnh (css, js, json, ảnh) ở thư mục gốc
app.use(express.static(__dirname));

const RESULTS_FILE = path.join(__dirname, 'results.json');

function getResults() {
    if (!fs.existsSync(RESULTS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

// 2. Định tuyến rõ ràng cho trang chủ: Luôn trả về index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. API Đăng nhập Admin
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const ADMIN_USER = process.env.ADMIN_USER || "admin";
    const ADMIN_PASS = process.env.ADMIN_PASS || "cuong123";

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        return res.json({ success: true, message: 'Đăng nhập Admin thành công!' });
    } else {
        return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu quản trị!' });
    }
});

// 4. API Nhận kết quả Quiz từ học viên
app.post('/api/submit-quiz', (req, res) => {
    const { studentName, topicId, quizType, score, total, date } = req.body || {};

    if (!studentName || score === undefined) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin học viên hoặc điểm số!' });
    }

    const results = getResults();
    const newRecord = {
        id: Date.now(),
        studentName: String(studentName).trim(),
        topicId,
        quizType,
        score,
        total,
        date: date || new Date().toLocaleString('vi-VN')
    };

    results.unshift(newRecord);
    try {
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
    } catch (err) {
        console.error('Lỗi ghi results.json:', err.message);
    }

    return res.json({ success: true, message: 'Đã gửi kết quả về cho Admin thành công!' });
});

// 5. API Cho Admin lấy danh sách kết quả học viên
app.get('/api/admin/results', (req, res) => {
    return res.json(getResults());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang lắng nghe tại cổng ${PORT}`);
});
