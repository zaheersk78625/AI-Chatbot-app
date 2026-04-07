import { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { auth, db, googleProvider } from './lib/firebase';
import { Conversation, Message } from './types';
import { generateAIResponse } from './services/ai';
import { performOCR } from './services/ocr';
import { cn } from './lib/utils';
import { 
  Send, 
  Image as ImageIcon, 
  Plus, 
  LogOut, 
  MessageSquare, 
  Trash2, 
  Loader2, 
  User as UserIcon,
  Bot,
  ScanText,
  X,
  Menu,
  Mic,
  MicOff,
  Pencil,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMsgText, setEditMsgText] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('');
        setInputText(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech Recognition Error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleUpdateTitle = async (id: string) => {
    if (!newTitle.trim()) return;
    await updateDoc(doc(db, 'conversations', id), {
      title: newTitle,
      updatedAt: serverTimestamp()
    });
    setEditingTitleId(null);
  };

  const handleUpdateMessage = async (msg: Message) => {
    if (!editMsgText.trim() || !currentConvId || !msg.id) return;
    
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'conversations', currentConvId, 'messages', msg.id), {
        text: editMsgText,
        timestamp: serverTimestamp()
      });

      // Update conversation last message if it was the last one
      if (conversations.find(c => c.id === currentConvId)?.lastMessage === msg.text) {
        await updateDoc(doc(db, 'conversations', currentConvId), {
          lastMessage: editMsgText,
          updatedAt: serverTimestamp()
        });
      }

      setEditingMessageId(null);
    } catch (error) {
      console.error("Update Message Error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Conversations Listener
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'conversations'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const convs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Conversation));
      setConversations(convs);
    });
    return unsubscribe;
  }, [user]);

  // Messages Listener
  useEffect(() => {
    if (!currentConvId) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'conversations', currentConvId, 'messages'),
      orderBy('timestamp', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message));
      setMessages(msgs);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    return unsubscribe;
  }, [currentConvId]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const createNewConversation = async () => {
    if (!user) return;
    const docRef = await addDoc(collection(db, 'conversations'), {
      userId: user.uid,
      title: 'New Chat',
      lastMessage: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    setCurrentConvId(docRef.id);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentConvId === id) setCurrentConvId(null);
    await deleteDoc(doc(db, 'conversations', id));
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const sendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || !user || isProcessing) return;

    let convId = currentConvId;
    if (!convId) {
      const docRef = await addDoc(collection(db, 'conversations'), {
        userId: user.uid,
        title: inputText.slice(0, 30) || 'Image Chat',
        lastMessage: inputText,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      convId = docRef.id;
      setCurrentConvId(convId);
    }

    setIsProcessing(true);
    const userMsgText = inputText;
    const userImg = selectedImage;
    setInputText('');
    setSelectedImage(null);

    try {
      // 1. OCR if image exists
      let currentOcrText = '';
      if (userImg) {
        currentOcrText = await performOCR(userImg);
      }

      // 2. Save User Message
      await addDoc(collection(db, 'conversations', convId, 'messages'), {
        conversationId: convId,
        sender: 'user',
        text: userMsgText,
        imageUrl: userImg,
        ocrText: currentOcrText,
        timestamp: serverTimestamp()
      });

      // 3. Update Conversation
      await updateDoc(doc(db, 'conversations', convId), {
        lastMessage: userMsgText || 'Sent an image',
        updatedAt: serverTimestamp()
      });

      // 4. Get AI Response
      const history = messages.map(m => ({
        role: m.sender === 'user' ? 'user' as const : 'model' as const,
        parts: [{ text: m.text }]
      }));

      const aiResponse = await generateAIResponse(
        userMsgText || "Analyze this image.",
        userImg ? { data: userImg.split(',')[1], mimeType: 'image/png' } : undefined,
        history
      );

      // 5. Save AI Message
      await addDoc(collection(db, 'conversations', convId, 'messages'), {
        conversationId: convId,
        sender: 'ai',
        text: aiResponse,
        timestamp: serverTimestamp()
      });

    } catch (error) {
      console.error("Message Error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tighter">Visionary AI</h1>
            <p className="text-zinc-400">Advanced multimodal chatbot with real-time vision and OCR capabilities.</p>
          </div>
          <button 
            onClick={handleLogin}
            className="w-full py-3 px-4 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
          >
            <UserIcon className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      <div className="aurora-bg" />
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside 
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="w-72 glass-sidebar flex flex-col z-20"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <button 
                onClick={createNewConversation}
                className="flex-1 flex items-center gap-2 py-2 px-3 btn-vibrant rounded-lg transition-all text-sm font-semibold shadow-lg shadow-pink-500/20"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="ml-2 p-2 hover:bg-white/5 rounded-lg lg:hidden"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {conversations.map(conv => (
                <div 
                  key={conv.id}
                  onClick={() => setCurrentConvId(conv.id)}
                  className={cn(
                    "group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all",
                    currentConvId === conv.id ? "bg-white/10 text-white shadow-lg border border-white/10" : "hover:bg-white/5 text-zinc-400"
                  )}
                >
                  <div className="flex items-center gap-3 truncate flex-1">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      currentConvId === conv.id ? "bg-pink-500 animate-pulse" : "bg-zinc-700"
                    )} />
                    {editingTitleId === conv.id ? (
                      <input 
                        autoFocus
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onBlur={() => handleUpdateTitle(conv.id)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdateTitle(conv.id)}
                        className="bg-black/40 text-xs py-1 px-2 rounded border border-white/10 w-full focus:outline-none"
                      />
                    ) : (
                      <span className="text-sm truncate font-medium">{conv.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTitleId(conv.id);
                        setNewTitle(conv.title);
                      }}
                      className="p-1 hover:text-pink-400"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button 
                      onClick={(e) => deleteConversation(conv.id, e)}
                      className="p-1 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-white/5 space-y-4">
              <div className="flex items-center gap-3 px-2">
                <div className="relative">
                  <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-white/20" alt="" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-zinc-900 rounded-full" />
                </div>
                <div className="flex-1 truncate">
                  <p className="text-sm font-semibold truncate">{user.displayName}</p>
                  <p className="text-[10px] text-zinc-500 truncate uppercase tracking-wider">{user.email}</p>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-2 p-2 text-xs text-zinc-500 hover:text-pink-400 transition-colors font-medium"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0 bg-transparent">
        {/* Header */}
        <header className="h-14 border-b border-white/5 flex items-center px-4 gap-4 bg-black/20 backdrop-blur-md sticky top-0 z-10">
          {!isSidebarOpen && (
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-white/5 rounded-lg">
              <Menu className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-pink-500 shadow-[0_0_10px_rgba(255,0,128,0.5)]" />
            <h2 className="font-bold text-sm tracking-tight">
              {currentConvId ? conversations.find(c => c.id === currentConvId)?.title : 'Visionary AI'}
            </h2>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-8">
          {messages.length === 0 && !currentConvId && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 rounded-3xl btn-vibrant flex items-center justify-center shadow-2xl shadow-pink-500/40">
                <Bot className="w-10 h-10 text-white" />
              </div>
              <div className="space-y-2">
                <h3 className="text-3xl font-bold tracking-tighter bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent">
                  Welcome to Visionary
                </h3>
                <p className="text-zinc-400 text-sm max-w-xs mx-auto">
                  Experience the future of AI with real-time vision, OCR, and voice.
                </p>
              </div>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={msg.id || i}
              className={cn(
                "flex gap-4 max-w-4xl mx-auto",
                msg.sender === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg",
                msg.sender === 'user' ? "btn-vibrant" : "bg-white/10 border border-white/10"
              )}>
                {msg.sender === 'user' ? <UserIcon className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-pink-500" />}
              </div>
              <div className={cn(
                "space-y-2 max-w-[85%]",
                msg.sender === 'user' ? "items-end" : "items-start"
              )}>
                {msg.imageUrl && (
                  <div className="relative group">
                    <img 
                      src={msg.imageUrl} 
                      className="rounded-2xl max-h-64 object-cover border border-white/10 shadow-2xl" 
                      alt="Uploaded" 
                    />
                    {msg.ocrText && (
                      <div className="mt-2 p-3 bg-black/40 backdrop-blur-md rounded-xl border border-white/10 text-[11px] text-zinc-400">
                        <div className="flex items-center gap-2 mb-1 text-pink-400 font-bold uppercase tracking-widest">
                          <ScanText className="w-3 h-3" />
                          OCR Data
                        </div>
                        <p className="line-clamp-3 italic leading-relaxed">{msg.ocrText}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className={cn(
                  "p-4 rounded-2xl text-sm leading-relaxed relative group/msg shadow-xl",
                  msg.sender === 'user' 
                    ? "bg-white/10 border border-white/10 text-zinc-100 rounded-tr-none" 
                    : "bg-black/20 backdrop-blur-sm border border-white/5 text-zinc-300 rounded-tl-none"
                )}>
                  {msg.sender === 'user' && editingMessageId !== msg.id && (
                    <button 
                      onClick={() => {
                        setEditingMessageId(msg.id || null);
                        setEditMsgText(msg.text);
                      }}
                      className="absolute -left-8 top-2 p-1 opacity-0 group-hover/msg:opacity-100 hover:text-pink-400 transition-all"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}

                  {editingMessageId === msg.id ? (
                    <div className="space-y-2 min-w-[300px]">
                      <textarea 
                        autoFocus
                        value={editMsgText}
                        onChange={(e) => setEditMsgText(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-pink-500/50 min-h-[100px] transition-colors"
                      />
                      <div className="flex justify-end gap-3">
                        <button 
                          onClick={() => setEditingMessageId(null)}
                          className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => handleUpdateMessage(msg)}
                          className="text-[10px] font-bold uppercase tracking-wider text-pink-500 hover:text-pink-400 flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="prose prose-invert max-w-none prose-sm">
                      <ReactMarkdown>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                <p className="text-[9px] text-zinc-600 px-2 font-medium uppercase tracking-tighter">
                  {msg.timestamp?.toDate ? format(msg.timestamp.toDate(), 'HH:mm') : ''}
                </p>
              </div>
            </motion.div>
          ))}
          <div ref={scrollRef} />
        </div>

        {/* Input Area */}
        <div className="p-6 max-w-4xl mx-auto w-full space-y-4">
          <AnimatePresence>
            {selectedImage && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className="relative inline-block"
              >
                <img src={selectedImage} className="h-28 w-28 object-cover rounded-2xl border-2 border-pink-500 shadow-2xl shadow-pink-500/20" alt="" />
                <button 
                  onClick={() => setSelectedImage(null)}
                  className="absolute -top-2 -right-2 p-1.5 bg-black rounded-full border border-white/10 hover:bg-zinc-900 shadow-lg"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative flex items-end gap-2 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-3 focus-within:border-pink-500/30 transition-all shadow-2xl">
            <div className="flex items-center gap-1">
              <label className="p-2.5 hover:bg-white/5 rounded-2xl cursor-pointer transition-all hover:text-pink-400 text-zinc-400">
                <ImageIcon className="w-5 h-5" />
                <input type="file" className="hidden" accept="image/*" onChange={handleImageSelect} />
              </label>
              <button 
                onClick={toggleListening}
                className={cn(
                  "p-2.5 rounded-2xl transition-all relative",
                  isListening ? "text-pink-500 bg-pink-500/10" : "text-zinc-400 hover:bg-white/5 hover:text-pink-400"
                )}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-5 h-5" />
                    <span className="absolute inset-0 rounded-2xl bg-pink-500/20 animate-ping" />
                  </>
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>
            </div>
            <textarea 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Type a message or upload an image..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2.5 resize-none max-h-40 min-h-[44px] placeholder:text-zinc-600"
              rows={1}
            />
            <button 
              onClick={sendMessage}
              disabled={isProcessing || (!inputText.trim() && !selectedImage)}
              className={cn(
                "w-11 h-11 flex items-center justify-center rounded-2xl transition-all shadow-lg",
                isProcessing || (!inputText.trim() && !selectedImage) 
                  ? "bg-white/5 text-zinc-700" 
                  : "btn-vibrant text-white shadow-pink-500/20"
              )}
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
          <div className="flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-700">
            <span>Visionary AI</span>
            <span className="w-1 h-1 rounded-full bg-zinc-800" />
            <span>Multimodal</span>
            <span className="w-1 h-1 rounded-full bg-zinc-800" />
            <span>Real-time</span>
          </div>
        </div>
      </main>
    </div>
  );
}
