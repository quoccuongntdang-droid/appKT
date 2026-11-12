<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flashcard Ôn Tập Kinh Thánh</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 15px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
        .container { max-width: 450px; width: 100%; background: white; padding: 20px; border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; }
        h2 { text-align: center; color: #2c3e50; margin-bottom: 15px; font-size: 20px; }
        .controls { margin-bottom: 20px; display: flex; flex-direction: column; gap: 10px; }
        select, button { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #ccc; font-size: 15px; box-sizing: border-box; }
        .btn-random { background: #e67e22; color: white; border: none; font-weight: bold; cursor: pointer; }
        .btn-random:hover { background: #d35400; }
        
        /* Hiệu ứng lật thẻ Flashcard */
        .flashcard-container { perspective: 1000px; width: 100%; height: 260px; margin-bottom: 20px; cursor: pointer; }
        .flashcard { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; transition: transform 0.6s; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
        .flashcard.flipped { transform: rotateY(180deg); }
        .card-face { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; border-radius: 12px; text-align: center; }
        .card-front { background: #ffffff; border: 2px solid #3498db; color: #2c3e50; }
        .card-back { background: #ebf5fb; border: 2px solid #2980b9; color: #1b4f72; transform: rotateY(180deg); }
        
        .card-title { font-size: 13px; color: #7f8c8d; margin-bottom: 8px; text-transform: uppercase; font-weight: bold; }
        .card-ref { font-size: 22px; font-weight: bold; color: #2980b9; }
        .card-text { font-size: 16px; line-height: 1.5; }
        .hint { font-size: 12px; color: #95a5a6; margin-top: 15px; font-style: italic; }

        .nav-buttons { display: flex; gap: 10px; }
        .btn-nav { flex: 1; background: #27ae60; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; }
        .btn-nav:hover { background: #219653; }
        .progress { text-align: center; margin-top: 15px; font-size: 14px; color: #555; font-weight: bold; }
    </style>
</head>
<body>

    <div class="container">
        <h2>📖 Ôn Tập Kinh Thánh</h2>
        
        <div class="controls">
            <select id="lessonSelect" onchange="changeLesson()">
                <!-- Danh sách bài học sẽ được nạp tự động từ JSON -->
            </select>
            <button class="btn-random" onclick="selectRandomLesson()">🎲 Chọn Bài Ngẫu Nhiên</button>
        </div>

        <div class="flashcard-container" onclick="flipCard()">
            <div class="flashcard" id="card">
                <div class="card-face card-front">
                    <div class="card-title" id="frontLessonTitle">Đang tải...</div>
                    <div class="card-ref" id="frontRef">...</div>
                    <div class="hint">(Chạm vào thẻ để lật xem nội dung)</div>
                </div>
                <div class="card-face card-back">
                    <div class="card-title">Nội Dung Kinh Thánh</div>
                    <div class="card-text" id="backText">...</div>
                </div>
            </div>
        </div>

        <div class="nav-buttons">
            <button class="btn-nav" onclick="prevVerse()">⬅️ Câu Trước</button>
            <button class="btn-nav" onclick="nextVerse()">Câu Sau ➡️</button>
        </div>

        <div class="progress" id="progressText">Bài 1 / Câu 1 của 2</div>
    </div>

    <script>
        // --- CƠ SỞ DỮ LIỆU JSON 50 BÀI (Mẫu mô phỏng theo app của bạn) ---
        const bibleData = [
            {
                id: 1,
                title: "1-1. Mầu nhiệm về sự tha tội và Đấng An Sang Hồng",
                verses: [
                    { ref: "Sáng Thế Ký 2:7", text: "Đức Chúa Trời lấy bụi đất nắn nên hình người, hà sanh khí vào lỗ mũi; thì người trở nên một loài sanh linh." },
                    { ref: "Truyền Đạo 12:7", text: "Và bụi tro trở đất y như nguyên cũ, và thần linh trở về nơi Đức Chúa Trời, là Đấng đã ban nó." }
                ]
            },
            {
                id: 2,
                title: "1-2. Đấng Cứu Chúa theo mỗi thời đại và danh mới",
                verses: [
                    { ref: "Công Vụ Các Sứ Tồ 4:12", text: "Chẳng có sự cứu rỗi trong đấng nào khác; vì dưới trời chẳng có danh nào khác đặt chọn loài người, để chúng ta phải nhờ đó mà được cứu." },
                    { ref: "Khải Huyền 3:12", text: "Kẻ nào thắng, ta sẽ cho làm trụ trong đền Đức Chúa Trời tôi... và ta sẽ viết tên danh mới ta trên người ấy." }
                ]
            },
            {
                id: 3,
                title: "1-3. Trái Sự Sống và Đấng An Sang Hồng",
                verses: [
                    { ref: "Sáng Thế Ký 3:22-24", text: "Giê-hô-va Đức Chúa Trời phán rằng: Này, người đã thành một kẻ như Chúng Ta... Ngài bèn đuổi loài người ra khỏi..." },
                    { ref: "Giăng 6:53-54", text: "Đức Chúa Jêsus phán cùng họ rằng: Quả thật, quả thật, ta nói cùng các ngươi, nếu các ngươi không ăn thịt Con Người và không uống huyết Ngài, thì không có sự sống trong mình..." }
                ]
            }
            // Bạn có thể tiếp tục bổ sung các bài từ 4 đến 50 vào đây một cách cực kỳ dễ dàng!
        ];

        let currentLessonIndex = 0;
        let currentVerseIndex = 0;
        let isFlipped = false;

        function initApp() {
            const select = document.getElementById('lessonSelect');
            select.innerHTML = '';
            bibleData.forEach((lesson, index) => {
                let opt = document.createElement('option');
                opt.value = index;
                opt.textContent = lesson.title;
                select.appendChild(opt);
            });
            loadCard();
        }

        function loadCard() {
            const lesson = bibleData[currentLessonIndex];
            const verse = lesson.verses[currentVerseIndex];
            
            document.getElementById('frontLessonTitle').textContent = lesson.title;
            document.getElementById('frontRef').textContent = verse.ref;
            document.getElementById('backText').textContent = verse.text;
            
            document.getElementById('progressText').textContent = `Bài ${currentLessonIndex + 1} | Câu ${currentVerseIndex + 1} / ${lesson.verses.length}`;
            
            // Đưa thẻ về mặt trước khi chuyển câu/bài
            if(isFlipped) {
                flipCard();
            }
        }

        function flipCard() {
            const card = document.getElementById('card');
            card.classList.toggle('flipped');
            isFlipped = !isFlipped;
        }

        function nextVerse() {
            const lesson = bibleData[currentLessonIndex];
            if (currentVerseIndex < lesson.verses.length - 1) {
                currentVerseIndex++;
            } else {
                currentVerseIndex = 0; // Quay lại câu đầu tiên của bài
            }
            loadCard();
        }

        function prevVerse() {
            const lesson = bibleData[currentLessonIndex];
            if (currentVerseIndex > 0) {
                currentVerseIndex--;
            } else {
                currentVerseIndex = lesson.verses.length - 1; // Về câu cuối bài
            }
            loadCard();
        }

        function changeLesson() {
            const select = document.getElementById('lessonSelect');
            currentLessonIndex = parseInt(select.value);
            currentVerseIndex = 0;
            loadCard();
        }

        function selectRandomLesson() {
            // Chọn ngẫu nhiên một bài trong danh sách dữ liệu hiện có
            currentLessonIndex = Math.floor(Math.random() * bibleData.length);
            document.getElementById('lessonSelect').value = currentLessonIndex;
            currentVerseIndex = 0;
            loadCard();
        }

        // Chạy khởi tạo khi mở trang
        window.onload = initApp;
    </script>
</body>
</html>
