const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const port = 6789;
const app = express();

const dbPath = path.resolve(__dirname, 'cumparaturi.db');

app.set('view engine', 'ejs');

app.use(expressLayouts);

app.use(express.static('public'));

app.use(cookieParser());

app.use(session({
    secret: 'cheie-secreta-pentru-sesiuni',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } 
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let listaIntrebari = [];

// citire din intrebari.json
async function readQuestions() {
    try {
        const data = await fs.readFile('intrebari.json', 'utf8');
        listaIntrebari = JSON.parse(data);
    } catch (err) {
        console.error('Error reading questions:', err);
    }
}

// citire intrebari cand porneste serverul
readQuestions();

app.get('/', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    db.all('SELECT * FROM produse', (err, produse) => {
        if (err) {
            console.error('Eroare la citirea produselor:', err.message);
            res.render('index', { utilizator: req.session.utilizator, produse: [] });
        } else {
            res.render('index', { utilizator: req.session.utilizator, produse: produse });
        }
        db.close();
    });
});

app.get('/vizualizare-cos', (req, res) => {
    const db = new sqlite3.Database(dbPath);
    const cos = req.session.cos || [];
    if (cos.length > 0) {
        const placeholders = cos.map(() => '?').join(',');
        db.all(`SELECT * FROM produse WHERE id IN (${placeholders})`, cos, (err, produse) => {
            if (err) {
                console.error('Eroare la citirea produselor din coș:', err.message);
                res.render('vizualizare-cos', { cosProduse: [], total: 0 });
            } else {
                const total = produse.reduce((sum, produs) => sum + produs.pret, 0);
                res.render('vizualizare-cos', { cosProduse: produse, total: total });
            }
            db.close();
        });
    } else {
        res.render('vizualizare-cos', { cosProduse: [], total: 0 });
    }
});

app.get('/chestionar', async (req, res) => {
    await readQuestions(); // citirea intrebarilor inainte de randare
    res.render('chestionar', { intrebari: listaIntrebari, utilizator: req.session.utilizator });
});

app.get('/autentificare', (req, res) => {
    res.render('autentificare');
});

// creare baza de date
let db = new sqlite3.Database('cumparaturi.db');
db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS produse (id INTEGER PRIMARY KEY, nume TEXT, pret REAL, cantitate INTEGER)', (err) => {
        if (err) {
            console.error('Eroare la crearea tabelei:', err.message);
        } else {
            console.log('Tabela "produse" a fost creată sau există deja.');
        }
    });
});

// inserarea datelor în baza de date
app.post('/inserare-db', (req, res) => {
    const { nume, pret, cantitate } = req.body;
    const db = new sqlite3.Database(dbPath);

    db.run("INSERT INTO produse (nume, pret, cantitate) VALUES (?, ?, ?)", [nume, pret, cantitate], (err) => {
        if (err) {
            console.error('Error inserting data into produse:', err.message);
        } else {
            console.log('Datele au fost inserate cu succes în tabelul produse!');
        }
        db.close((err) => {
            if (err) {
                console.error('Error closing the database:', err.message);
            }
        });
    });

    res.redirect('/');
});

app.post('/verificare-autentificare', async (req, res) => {
    const { utilizator, parola } = req.body;

    // citire utilizatori.json
    const utilizatoriData = await fs.readFile('utilizatori.json', 'utf8');
    const utilizatori = JSON.parse(utilizatoriData);

    // gasirea utilizatorului
   
    const user = utilizatori.find(u => u.username === utilizator && u.password === parola);

    if (user) {
        req.session.utilizator = {
            username: user.username,
            nume: user.nume,
            prenume: user.prenume,
            rol: user.rol
        };
        res.redirect('/');
    } else {
        res.redirect('/autentificare');
    }
});


// verifica daca utilizatorul este autentificat
function requireAdmin(req, res, next) {
    if (req.session.utilizator && req.session.utilizator.rol === 'ADMIN') {
        next();
    } else {
        res.status(403).send('Acces interzis.');
    }
}

app.get('/admin', requireAdmin, (req, res) => {
    res.render('admin', { utilizator: req.session.utilizator });
});

// procesarea rezultatelor chestionarului
app.post('/rezultat-chestionar', (req, res) => {
    const raspunsuri = req.body;
    let numarRaspunsuriCorecte = 0;

    listaIntrebari.forEach((intrebare, index) => {
        const raspunsUtilizator = raspunsuri[`intrebare${index}`];
        if (raspunsUtilizator === intrebare.correct) {
            numarRaspunsuriCorecte++;
        }
    });

    res.render('rezultat-chestionar', {
        numarRaspunsuriCorecte: numarRaspunsuriCorecte,
        totalIntrebari: listaIntrebari.length
    });
});

// adaugarea unui produs in cos
app.post('/adaugare_cos', (req, res) => {
    const produsId = req.body.id;
    if (!req.session.cos) {
        req.session.cos = [];
    }
    req.session.cos.push(produsId);
    res.redirect('/');
});

// eliminare produs din cos
app.post('/elimina-din-cos/:id', (req, res) => {
    const produsId = req.params.id;
    if (req.session.cos) {
        req.session.cos = req.session.cos.filter(id => id !== produsId);
    }
    res.redirect('/vizualizare-cos');
});

// nefinalizat plata finalizata
app.post('/finalizeaza-comanda', (req, res) => {
    
    req.session.cos = [];
    res.redirect('/vizualizare-cos');
});

app.listen(port, () => {
    console.log(`Serverul rulează la http://localhost:${port}`);
});


// adaugare produs in baza de date
app.post('/inserare-produs', requireAdmin, (req, res) => {
    const { nume, pret, cantitate } = req.body;
    const db = new sqlite3.Database(dbPath);

    db.run("INSERT INTO produse (nume, pret, cantitate) VALUES (?, ?, ?)", [nume, pret, cantitate], (err) => {
        if (err) {
            console.error('Error inserting data into produse:', err.message);
            res.status(500).send('Eroare la inserarea produsului în baza de date.');
        } else {
            console.log('Datele au fost inserate cu succes în tabelul produse!');
            res.redirect('/');
        }
        db.close((err) => {
            if (err) {
                console.error('Error closing the database:', err.message);
            }
        });
    });
});


// deconectare si golire cos
app.get('/deconectare', (req, res) => {
    // golire cos
    req.session.cos = [];
    // elimina datele utilizatorului
    req.session.utilizator = null;
    // redirectionare la pagina de autentficare
    res.redirect('/autentificare');
});



