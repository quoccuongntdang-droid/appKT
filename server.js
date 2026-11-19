const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Thư mục chứa index.html và data.json

const RESULTS_FILE = path.join(__dirname, 'results.json');

// Hàm đọc dữ liệu kết quả
function getResults() {
    if (!fs.existsSync(RESULTS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

// 1. API Nhận kết quả từ học viên khi nộp bài Quiz
app.post('/api/submit-quiz', (req, res) => {
    const { studentName, topicId, quizType, score, total, date } = req.body;
    
    if (!studentName || score === undefined) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin học viên hoặc điểm số!' });
    }

    const results = getResults();
    const newRecord = {
        id: Date.now(),
        studentName: studentName.trim(),
        topicId: topicId,
        quizType: quizType, // Kiểm tra 1, 2 hay 3
        score: score,
        total: total,
        date: date || new Date().toLocaleString('vi-VN')
    };

    results.unshift(newRecord); // Đưa kết quả mới nhất lên đầu danh sách
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');

    res.json({ success: true, message: 'Đã gửi kết quả về cho Admin thành công!' });
});

// 2. API Cho Admin xem toàn bộ danh sách kết quả học viên gửi về
app.get('/api/admin/results', (req, res) => {
    // (Tùy chọn) Bạn có thể thêm bảo Mật Password ở đây nếu muốn
    const results = getResults();
    res.json(results);
});

// 3. API Đăng nhập Admin đơn giản
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    // Thay đổi thông tin username và password của riêng bạn tại đây
    const ADMIN_USER = "admin";
    const ADMIN_PASS = "cuong123"; // Mật khẩu của bạn

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        res.json({ success: true, message: 'Đăng nhập Admin thành công!' });
    } else {
        res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu quản trị!' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng ${PORT}`);
});
