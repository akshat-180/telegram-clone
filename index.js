const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');
const bcrypt = require('bcrypt');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const port = 3009;

const USERS_FILE = path.join(__dirname, 'users.json');

let connectedUsers = [];

app.use(express.json());

// Middleware for API routes only - apply Content-Type: application/json
// These need to be before the routes
const jsonContentType = (req, res, next) => {
    res.type('json');
    next();
};
app.use(express.static(path.join(__dirname, 'public')));
app.use('/chats', express.static(path.join(__dirname, 'chats')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});
app.get('/about',(req,res)=>{
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
})

app.post('/login', jsonContentType, (req, res) => {
    try {
        const { phone, password } = req.body;
        const users = loadUsers();
        
        const user = users.find(u => u.phone === phone);
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }
        
        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {

                res.json({ message: 'Login successful', phone: phone, redirect: '/chat.html' });
                

            } else {
                res.status(401).json({ message: 'Invalid credentials' });
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: 'Server error during login' });
    }
});

app.post('/signup', jsonContentType, (req, res) => {
    try {
        const { firstName, lastName, phone, password } = req.body;
        const users = loadUsers();

        if (users.find(u => u.phone === phone)) {
            return res.status(400).json({ message: 'Phone number already registered' });
        }

        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) return res.status(500).json({ message: 'Error hashing password' });

            users.push({ firstName, lastName, phone, password: hashedPassword ,friends: [] ,ownedGroup: [] ,joinedGroup: []});
            saveUsers(users);
            res.json({ message: 'Signup successful' });
        });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ message: 'Server error during signup' });
    }
});

app.post('/update', jsonContentType, (req, res) => {
    try {
        const { firstName, lastName, phone, password } = req.body;
        const users = loadUsers();

        const userIndex = users.findIndex(u => u.phone === phone);
        if (userIndex === -1) {
            return res.status(400).json({ message: 'User not found' });
        }

        if (firstName) users[userIndex].firstName = firstName;
        if (lastName) users[userIndex].lastName = lastName;
        
        if (password) {
            bcrypt.hash(password, 10, (err, hashedPassword) => {
                if (err) return res.status(500).json({ message: 'Error hashing password' });

                users[userIndex].password = hashedPassword;
                saveUsers(users);
                res.json({ message: 'User updated successfully' });
            });
        } else {
            saveUsers(users);
            res.json({ message: 'User updated successfully' });
        }
    } catch (error) {
        console.error("Update error:", error);
        res.status(500).json({ message: 'Server error during update' });
    }
});

app.post('/delete', jsonContentType, (req, res) => {
    try {
        const { phone } = req.body;
        const users = loadUsers();

        const userIndex = users.findIndex(u => u.phone === phone);
        if (userIndex === -1) {
            return res.status(400).json({ message: 'User not found' });
        }

        users.splice(userIndex, 1);
        saveUsers(users);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({ message: 'Server error during delete' });
    }
});

const loadUsers = () => {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            // Create empty users file if it doesn't exist
            fs.writeFileSync(USERS_FILE, '[]', 'utf8');
            return [];
        }
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading users.json:", error);
        return [];
    }
};

const saveUsers = (users) => {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving users.json:", error);
    }
};
//                                                                                    ADD FRIEND
const chatFolder = path.join(__dirname, 'chats');
if (!fs.existsSync(chatFolder)) {
    fs.mkdirSync(chatFolder);
}


//                                                                                    CREATE GROUP
app.post('/create-group', jsonContentType, (req, res) => {
    try {
        const { owner, members, name } = req.body;
        const users = loadUsers();
        const gid = uuidv4();

        // Find the owner object
        const ownerUser = users.find(u => u.phone === owner);
        if (!ownerUser) {
            return res.status(404).json({ message: 'Owner not found' });
        }

        // Update members' joinedGroup
        members.forEach(member => {
            const fullMember = users.find(u => u.phone === member.phone);
            if (!fullMember) {
                return res.status(404).json({ message: `Member ${member.phone} not found` });
            }

            fullMember.joinedGroup.push({
                joinedGroup_group_id: gid,
                group_name: name
            });
        });

        // Add to owner's ownedGroup
        ownerUser.ownedGroup.push({
            group_id: gid,
            group_name: name
        });

        // Save updated users
        saveUsers(users);

        // Create chat file
        const fileName = `${gid}.json`;
        const filePath = path.join(chatFolder, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify([])); // Empty array for messages
        }

        return res.status(200).json({ message: 'Group created successfully', group_id: gid });
    } catch (error) {
        console.error('Create group error:', error.message, error.stack);
        return res.status(500).json({ message: 'Server error while creating group' });
    }
});

app.post('/add-friend', jsonContentType, (req, res) => {
    try {
        const { userPhone, friendPhone } = req.body;
        const users = loadUsers();

        const user = users.find(u => u.phone === userPhone);
        const friend = users.find(u => u.phone === friendPhone);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!friend) {
            return res.status(404).json({ message: 'Friend not found' });
        }

        const alreadyAdded = user.friends.some(f => f.phone === friendPhone);
        if (alreadyAdded) {
            return res.status(400).json({ message: 'Friend already added' });
        }
        const fid = uuidv4(); 
        user.friends.push({
            firstName: friend.firstName,
            lastName: friend.lastName,
            phone: friend.phone,
            id: fid
        });

        const reverseAlreadyAdded = friend.friends.some(f => f.phone === userPhone);
        if (!reverseAlreadyAdded) {
            friend.friends.push({
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone,
                id: fid
            });
        }

        saveUsers(users);

        // ✅ Create chat file if it doesn't exist
        const fileName = `${fid}.json`;
        const filePath = path.join(chatFolder, fileName);

        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify([])); // Empty array for messages
        }

        return res.json({ message: 'Friend added and chat file created', friends: user.friends });

    } catch (error) {
        console.error('Add friend error:', error);
        return res.status(500).json({ message: 'Server error while adding friend' });
    }
});
//                                                                                        to find friend for the list in the side bar
app.post('/friends', (req, res) => {
    const { phone } = req.body;

    fs.readFile('users.json', 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Failed to read file' });

        const users = JSON.parse(data);
        const user = users.find(u => u.phone === phone);

        if (!user) return res.status(404).json({ error: 'User not found' });

        // Send back friends array directly (contains firstName, lastName, phone)
       
        console.log("hello");
        res.json({ friends: user.friends ,ownedGroup: user.ownedGroup ,joinedGroup: user.joinedGroup });
    });
});

// io.on('connection', (socket) => {
//     console.log('a user connected');
//     socket.on('chat message', (msg) => {
//         console.log('message : '+ msg);
//         io.emit('chat message', msg);
//     })
//   });

// io.on('connection', (socket) => {
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);
    
        // Send updated user list to all clients
        io.emit('user list', connectedUsers);
    
        // When a user sends a message
        socket.on('chat message', (msg) => {
            console.log('message:', msg.message);
    
            const { receiver, sender, message, timestamp  } = msg;
    
            // Determine the chat file based on the sender and receiver
            const chatFile = path.join(chatFolder, `${msg.id}.json`);
    
            // Load the chat history
            fs.readFile(chatFile, 'utf8', (err, data) => {
                if (err) {
                    return console.error('Error reading chat file:', err);
                }
    
                const chatHistory = JSON.parse(data);
    
                // Append the new message to the chat history
                chatHistory.push({ receiver, sender, message, timestamp });
    
                // Save the updated chat history back to the file
                fs.writeFile(chatFile, JSON.stringify(chatHistory, null, 2), 'utf8', (err) => {
                    if (err) {
                        return console.error('Error writing to chat file:', err);
                    }
    
                    console.log('Message saved to chat file');
                    // Emit the message to the receiver and sender (just those two users)
                    io.to(receiver).emit('chat message', msg);
                    io.to(sender).emit('chat message', msg);
                });
            });
        });
    
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
            connectedUsers = connectedUsers.filter(id => id !== socket.id);
            io.emit('user list', connectedUsers); // update again
        });
    });
    

server.listen(port, ()=>{
    console.log("Port is running at :" + port );
})