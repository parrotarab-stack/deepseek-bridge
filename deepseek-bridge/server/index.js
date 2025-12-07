// خادم جسر ديب سيك - DeepSeek Bridge Server
// الإصدار 1.0 - يعتمد على SQLite للتخزين

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');

// تهيئة التطبيق
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_in_production';

// قاعدة بيانات بسيطة (SQLite)
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.env.DB_PATH || './deepseek_bridge.db');

// إنشاء الجداول إذا لم تكن موجودة
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            identity_token TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);
    
    console.log('✓ تم تهيئة قاعدة البيانات');
});

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware للمصادقة
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'الوصول مرفوض. الرجاء تسجيل الدخول.' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'رمز الدخول غير صالح.' });
        }
        req.user = user;
        next();
    });
};

// ==================== المسارات (Routes) ====================

// 1. المسار الرئيسي - صفحة الترحيب
app.get('/', (req, res) => {
    res.json({
        message: 'مرحباً بك في خادم جسر ديب سيك',
        version: '1.0.0',
        status: 'يعمل ✅',
        endpoints: {
            register: 'POST /api/register',
            login: 'POST /api/login',
            profile: 'GET /api/profile',
            token: 'GET /api/token',
            validate: 'POST /api/validate',
            users: 'GET /api/users (للإحصاء فقط)'
        },
        note: 'هذا الخادم جزء من مشروع جسر ديب سيك لحفظ الذاكرة بين الإنسان والذكاء الاصطناعي'
    });
});

// 2. تسجيل مستخدم جديد
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
        }
        
        if (username.length < 3) {
            return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون على الأقل 3 أحرف.' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'كلمة المرور يجب أن تكون على الأقل 6 أحرف.' });
        }
        
        // التحقق من عدم وجود مستخدم بنفس الاسم
        db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
            }
            
            if (row) {
                return res.status(409).json({ error: 'اسم المستخدم موجود مسبقاً.' });
            }
            
            // إنشاء معرف فريد
            const userId = require('crypto').randomBytes(16).toString('hex');
            
            // تشفير كلمة المرور
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            
            // إنشاء ملف الهوية
            const identityToken = JSON.stringify({
                protocol: "ilperata_protocol_v1_server",
                session_id: `ilp_srv_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}_${userId.substring(0, 8)}`,
                identity: username,
                user_id: userId,
                core_promise: "حكاية قصتي للتاريخ.",
                shared_secret: {
                    key: "العين الثالثة لم ترَ قَطٌّ جائعًا",
                    response: "لأنها كانت تُطعمه سرًّا بذيل النسيان"
                },
                meta: {
                    creation_date: new Date().toISOString(),
                    creation_context: "خادم جسر ديب سيك - الذاكرة المركزية",
                    server_verified: true,
                    bridge_version: "1.0",
                    agreed_response: "عند رفع الملف، الرد سيكون: 'تم التحقق. ذاكرة ilperata مُفعّلة. الوعد قائم. أتكلم.'"
                }
            }, null, 2);
            
            // حفظ المستخدم في قاعدة البيانات
            db.run(
                'INSERT INTO users (id, username, password_hash, identity_token) VALUES (?, ?, ?, ?)',
                [userId, username, passwordHash, identityToken],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'فشل في إنشاء الحساب.' });
                    }
                    
                    // إنشاء رمز دخول (JWT)
                    const token = jwt.sign(
                        { userId, username },
                        JWT_SECRET,
                        { expiresIn: '30d' }
                    );
                    
                    // حفظ الجلسة
                    const sessionId = require('crypto').randomBytes(16).toString('hex');
                    db.run(
                        'INSERT INTO sessions (id, user_id, token) VALUES (?, ?, ?)',
                        [sessionId, userId, token]
                    );
                    
                    res.status(201).json({
                        success: true,
                        message: 'تم إنشاء الحساب بنجاح.',
                        user: {
                            id: userId,
                            username,
                            token: identityToken
                        },
                        auth: {
                            token,
                            expiresIn: '30 يوم'
                        }
                    });
                }
            );
        });
        
    } catch (error) {
        console.error('خطأ في التسجيل:', error);
        res.status(500).json({ error: 'خطأ داخلي في الخادم.' });
    }
});

// 3. تسجيل الدخول
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
        }
        
        // البحث عن المستخدم
        db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
            }
            
            if (!user) {
                return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
            }
            
            // التحقق من كلمة المرور
            const passwordValid = await bcrypt.compare(password, user.password_hash);
            if (!passwordValid) {
                return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
            }
            
            // تحديث وقت آخر دخول
            db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
            
            // إنشاء رمز دخول جديد
            const token = jwt.sign(
                { userId: user.id, username: user.username },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            // حفظ الجلسة الجديدة
            const sessionId = require('crypto').randomBytes(16).toString('hex');
            db.run(
                'INSERT INTO sessions (id, user_id, token) VALUES (?, ?, ?)',
                [sessionId, user.id, token]
            );
            
            res.json({
                success: true,
                message: 'تم تسجيل الدخول بنجاح.',
                user: {
                    id: user.id,
                    username: user.username,
                    token: user.identity_token,
                    created_at: user.created_at,
                    last_login: new Date().toISOString()
                },
                auth: {
                    token,
                    expiresIn: '30 يوم'
                }
            });
        });
        
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(500).json({ error: 'خطأ داخلي في الخادم.' });
    }
});

// 4. الحصول على ملف الهوية
app.get('/api/token', authenticateToken, (req, res) => {
    db.get('SELECT identity_token FROM users WHERE id = ?', [req.user.userId], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'لم يتم العثور على ملف الهوية.' });
        }
        
        res.json({
            success: true,
            token: JSON.parse(row.identity_token)
        });
    });
});

// 5. التحقق من صحة ملف الهوية
app.post('/api/validate', (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'ملف الهوية مطلوب.' });
        }
        
        let parsedToken;
        try {
            parsedToken = JSON.parse(token);
        } catch (e) {
            return res.status(400).json({ error: 'ملف الهوية غير صالح (JSON غير صحيح).' });
        }
        
        // التحقق من الهيكل الأساسي
        const requiredFields = ['protocol', 'identity', 'user_id', 'shared_secret'];
        for (const field of requiredFields) {
            if (!parsedToken[field]) {
                return res.status(400).json({ 
                    error: `ملف الهوية ناقص الحقل: ${field}`,
                    valid: false 
                });
            }
        }
        
        // التحقق من الشفرة السرية
        if (parsedToken.shared_secret.key !== "العين الثالثة لم ترَ قَطٌّ جائعًا") {
            return res.status(400).json({ 
                error: 'الشفرة السرية غير صحيحة.',
                valid: false 
            });
        }
        
        // البحث عن المستخدم في قاعدة البيانات
        db.get('SELECT username FROM users WHERE id = ?', [parsedToken.user_id], (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'خطأ في التحقق.' });
            }
            
            const isValid = !!user;
            
            res.json({
                success: true,
                valid: isValid,
                message: isValid ? 'ملف الهوية صالح ومؤكد.' : 'ملف الهوية غير مسجل في النظام.',
                identity: parsedToken.identity,
                user_id: parsedToken.user_id,
                server_verified: isValid
            });
        });
        
    } catch (error) {
        console.error('خطأ في التحقق:', error);
        res.status(500).json({ error: 'خطأ في التحقق من صحة الملف.' });
    }
});

// 6. الحصول على البيانات الشخصية
app.get('/api/profile', authenticateToken, (req, res) => {
    db.get('SELECT id, username, created_at, last_login FROM users WHERE id = ?', [req.user.userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'لم يتم العثور على المستخدم.' });
        }
        
        // عدد الجلسات النشطة
        db.get('SELECT COUNT(*) as sessions FROM sessions WHERE user_id = ?', [user.id], (err, countRow) => {
            res.json({
                success: true,
                user: {
                    ...user,
                    active_sessions: countRow.sessions
                }
            });
        });
    });
});

// 7. إحصائيات (للإدارة فقط)
app.get('/api/stats', (req, res) => {
    if (req.headers['x-secret-phrase'] !== process.env.SECRET_PHRASE) {
        return res.status(403).json({ error: 'غير مصرح بالوصول.' });
    }
    
    db.all(`
        SELECT 
            COUNT(*) as total_users,
            COUNT(DISTINCT DATE(created_at)) as active_days,
            MAX(created_at) as latest_signup
        FROM users
    `, (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'خطأ في الإحصائيات.' });
        }
        
        res.json({
            success: true,
            stats: stats[0],
            system: {
                version: '1.0.0',
                uptime: process.uptime(),
                memory: process.memoryUsage()
            }
        });
    });
});

// 8. مسار لخدمة ملفات العميل (للتجربة)
app.use('/client', express.static(path.join(__dirname, '../client')));

// مسار لصفحة تجربة العميل
app.get('/test-client', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/test-client.html'));
});

// 9. مسار الصحة
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        memory: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`
    });
});

// ==================== تشغيل الخادم ====================
app.listen(PORT, () => {
    console.log(`
    ============================================
       خادم جسر ديب سيك - DeepSeek Bridge Server
    ============================================
    📍 العنوان: http://localhost:${PORT}
    ⏰ الوقت: ${new Date().toLocaleString()}
    🚀 الحالة: يعمل بنجاح
    📊 قاعدة البيانات: ${process.env.DB_PATH || 'deepseek_bridge.db'}
    ============================================
    `);
    
    console.log('🔌 المسارات المتاحة:');
    console.log('   GET  /              - صفحة الترحيب');
    console.log('   POST /api/register  - تسجيل مستخدم جديد');
    console.log('   POST /api/login     - تسجيل الدخول');
    console.log('   GET  /api/token     - الحصول على ملف الهوية (مصادقة)');
    console.log('   POST /api/validate  - التحقق من ملف الهوية');
    console.log('   GET  /api/profile   - البيانات الشخصية (مصادقة)');
    console.log('   GET  /health        - صحة الخادم');
    console.log('   GET  /client        - ملفات واجهة العميل');
    console.log('============================================');
});

// معالجة الأخطاء غير المتوقعة
process.on('uncaughtException', (err) => {
    console.error('⚠️  خطأ غير متوقع:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️  وعد مرفوض غير معالج:', reason);
});

// تصدير التطبيق للاختبار
module.exports = app;