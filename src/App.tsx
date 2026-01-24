import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { Zap, BookOpen, Settings, ChevronRight, Send, Award, BarChart2, Briefcase, RefreshCw, Lightbulb, MessageSquareWarning, MessageSquare } from 'lucide-react';

// --- Configuration & Environment Setup ---

// Helper to safely access Vite environment variables without crashing in non-Vite environments
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    return (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env[key] : '';
  } catch {
    return '';
  }
};

// 1. Try to load config from Vite Environment Variables (For Vercel Deployment)
const viteConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID')
};

// 2. Try to load config from Internal Canvas Environment (For Preview in this Chat)
const internalConfig = typeof window !== 'undefined' && (window as any).__firebase_config 
  ? JSON.parse((window as any).__firebase_config) 
  : null;

// 3. Select the active config
const firebaseConfig = viteConfig.apiKey ? viteConfig : internalConfig;
const isInternalEnv = !viteConfig.apiKey && !!internalConfig;

// Initialize Firebase
let app, auth, db;
try {
  if (firebaseConfig && firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } else {
    console.warn("Firebase configuration missing. App will run in offline UI mode.");
  }
} catch (e) {
  console.error("Firebase initialization failed:", e);
}

// --- Types ---
type QuestionType = 'Strategic' | 'Tactical' | 'Metrics';
type Industry = 'AI' | 'IoT' | 'Automotive' | 'SaaS' | 'Consumer' | 'Fintech';

interface Session {
  id?: string;
  timestamp: any;
  type: QuestionType;
  industry: Industry;
  question: string;
  answer: string;
  feedback: string;
  score: number;
  mode: 'drill' | 'deep-dive';
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// --- Components ---

const SettingsModal = ({ 
  isOpen, 
  onClose, 
  apiKey, 
  setApiKey, 
  industries, 
  setIndustries 
}: any) => {
  if (!isOpen) return null;

  const toggleIndustry = (ind: Industry) => {
    if (industries.includes(ind)) {
      setIndustries(industries.filter((i: string) => i !== ind));
    } else {
      setIndustries([...industries, ind]);
    }
  };

  const allIndustries: Industry[] = ['AI', 'IoT', 'Automotive', 'SaaS', 'Consumer', 'Fintech'];
  const hasEnvKey = !!getEnv('VITE_GEMINI_API_KEY');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-indigo-600" /> Coach Settings
        </h2>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key</label>
          <input 
            type="password" 
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasEnvKey ? "Using Env Var Key" : "AIzaSy..."}
            disabled={hasEnvKey}
            className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-100 disabled:text-gray-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            {hasEnvKey
              ? "Loaded securely from Environment Variables." 
              : "Required to generate questions."}
          </p>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Target Industries</label>
          <div className="flex flex-wrap gap-2">
            {allIndustries.map(ind => (
              <button
                key={ind}
                onClick={() => toggleIndustry(ind)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  industries.includes(ind) 
                    ? 'bg-indigo-100 text-indigo-800 border-indigo-200 border' 
                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}
              >
                {ind}
              </button>
            ))}
          </div>
        </div>

        <button 
          onClick={onClose}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          Save & Close
        </button>
      </div>
    </div>
  );
};

// --- Main Application ---

export default function App() {
  const [user, setUser] = useState<any>(null);
  
  // Logic: Use Env Var if available, otherwise check LocalStorage
  const envGeminiKey = getEnv('VITE_GEMINI_API_KEY');
  const [apiKey, setApiKey] = useState(() => envGeminiKey || localStorage.getItem('pm_coach_api_key') || '');
  
  const [selectedIndustries, setSelectedIndustries] = useState<Industry[]>(() => {
    const saved = localStorage.getItem('pm_coach_industries');
    return saved ? JSON.parse(saved) : ['AI', 'SaaS', 'Fintech'];
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [view, setView] = useState<'dashboard' | 'drill' | 'deep-dive'>('dashboard');
  
  // Drill State
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentType, setCurrentType] = useState<QuestionType>('Strategic');
  const [currentIndustry, setCurrentIndustry] = useState<Industry>('SaaS');
  const [userAnswer, setUserAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<any>(null);
  const [history, setHistory] = useState<Session[]>([]);

  // Deep Dive State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // New LLM Features State
  const [hint, setHint] = useState<string | null>(null);
  const [isGeneratingHint, setIsGeneratingHint] = useState(false);
  const [stakeholderChallenge, setStakeholderChallenge] = useState<string | null>(null);
  const [isGeneratingChallenge, setIsGeneratingChallenge] = useState(false);

  // Auth Init
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
      } else {
        try {
          // Internal Env uses Custom Tokens, Vercel Env uses Anonymous
          if (isInternalEnv && (window as any).__initial_auth_token) {
             await signInWithCustomToken(auth, (window as any).__initial_auth_token);
          } else {
             await signInAnonymously(auth);
          }
        } catch (e) {
          console.error("Auth failed:", e);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Persistence
  useEffect(() => { 
    if (!envGeminiKey) {
      localStorage.setItem('pm_coach_api_key', apiKey); 
    }
  }, [apiKey, envGeminiKey]);
  
  useEffect(() => { localStorage.setItem('pm_coach_industries', JSON.stringify(selectedIndustries)); }, [selectedIndustries]);

  // Load History
  useEffect(() => {
    if (!user || !db) return;
    
    // Determine path based on environment to ensure permissions work
    // In Internal Vibe Coding: artifacts/{appId}/users/{uid}/sessions
    // In Vercel Standalone: users/{uid}/sessions (Simpler path structure)
    let collectionRef;
    
    if (isInternalEnv) {
        const internalAppId = (window as any).__app_id || 'default';
        collectionRef = collection(db, 'artifacts', internalAppId, 'users', user.uid, 'sessions');
    } else {
        collectionRef = collection(db, 'users', user.uid, 'sessions');
    }

    try {
        const q = query(collectionRef, orderBy('timestamp', 'desc'), limit(20));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Session)));
        }, (err) => console.error("History sync error:", err));
        return () => unsubscribe();
    } catch (e) {
        console.error("Error setting up history listener:", e);
    }
  }, [user]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, view]);

  // --- LLM Logic ---

  const generateQuestion = async () => {
    if (!apiKey) { setIsSettingsOpen(true); return; }
    
    setIsLoading(true);
    setFeedback(null);
    setHint(null);
    setStakeholderChallenge(null);
    setUserAnswer('');
    
    const types: QuestionType[] = ['Strategic', 'Tactical', 'Metrics'];
    const type = types[Math.floor(Math.random() * types.length)];
    const industry = selectedIndustries[Math.floor(Math.random() * selectedIndustries.length)];
    
    setCurrentType(type);
    setCurrentIndustry(industry);

    const recentHistory = history.slice(0, 5).map(h => 
      `- [${h.type}] Score: ${h.score}/10. Topic: ${h.question.substring(0, 30)}...`
    ).join('\n');

    const prompt = `
      You are a Senior Product Interviewer.
      User's Recent Performance:
      ${recentHistory || "No recent history."}

      Task: Generate a challenging, bite-sized product interview question.
      Parameters: Type: ${type}, Industry: ${industry}, Format: 1-2 sentences max.
      Adaptive Logic: If scores are low, give foundational questions. If high, complex trade-offs.
      Only output the question text.
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      setCurrentQuestion(data.candidates?.[0]?.content?.parts?.[0]?.text || "Error generating question.");
    } catch (e) {
      setCurrentQuestion("Network error. Check your API key.");
    } finally {
      setIsLoading(false);
    }
  };

  const getHint = async () => {
    if (!apiKey || !currentQuestion) return;
    setIsGeneratingHint(true);
    
    const prompt = `
      You are a helpful PM Coach. The user is stuck on this question: "${currentQuestion}" (${currentType} type).
      Provide a subtle, 1-sentence hint to unblock them. 
      For Strategic: hint at market dynamics or user value.
      For Metrics: hint at the funnel or north star.
      For Tactical: hint at prioritization or MVP scope.
      DO NOT reveal the answer.
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      setHint(data.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (e) { console.error(e); } 
    finally { setIsGeneratingHint(false); }
  };

  const submitAnswer = async () => {
    if (!userAnswer.trim() || !apiKey) return;
    setIsLoading(true);

    const prompt = `
      You are an expert Product Management Interview Coach using "Lenny's Product Sense" framework.
      Framework: 1. COMPREHEND 2. IDENTIFY USERS 3. PAIN POINTS 4. SOLUTIONS 5. PRIORITIZE 6. MEASURE.
      
      Question: "${currentQuestion}"
      Type: ${currentType}
      User Answer: "${userAnswer}"

      Task:
      1. Rate 1-10. Deduct for jumping to solutions without user/problem definition.
      2. Feedback mapping to framework.
      3. One specific "Level Up" tip.
      
      Output JSON: { "score": number, "feedback": "string", "levelUp": "string" }
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const data = await response.json();
      const result = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
      setFeedback(result);

      if (user && db) {
        let collectionRef;
        if (isInternalEnv) {
            const internalAppId = (window as any).__app_id || 'default';
            collectionRef = collection(db, 'artifacts', internalAppId, 'users', user.uid, 'sessions');
        } else {
            collectionRef = collection(db, 'users', user.uid, 'sessions');
        }

        await addDoc(collectionRef, {
          timestamp: serverTimestamp(),
          type: currentType,
          industry: currentIndustry,
          question: currentQuestion,
          answer: userAnswer,
          feedback: result.feedback,
          score: result.score,
          mode: 'drill'
        });
      }
    } catch (e) { alert("Error submitting answer."); } 
    finally { setIsLoading(false); }
  };

  const generateChallenge = async () => {
    if (!apiKey || !userAnswer) return;
    setIsGeneratingChallenge(true);

    const prompt = `
      Context: PM Interview.
      Question: "${currentQuestion}"
      Answer: "${userAnswer}"
      
      You are a skeptical VP of Product. Identify a weakness, assumption, or missing metric in the user's answer.
      Generate ONE short, tough follow-up question to challenge them.
      Example: "You mentioned X, but how does that impact cannibalization of Y?"
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      setStakeholderChallenge(data.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (e) { console.error(e); }
    finally { setIsGeneratingChallenge(false); }
  };

  // --- Deep Dive Logic ---

  const startDeepDive = async () => {
    if (!apiKey) { setIsSettingsOpen(true); return; }
    setView('deep-dive');
    setChatHistory([]);
    setIsChatLoading(true);

    const industry = selectedIndustries[Math.floor(Math.random() * selectedIndustries.length)];
    
    const prompt = `
      You are a Senior Product Interviewer. 
      Generate a comprehensive Product Sense case study question for a candidate.
      Industry: ${industry}.
      
      Format:
      "Context: [Brief context about a company situation]
      Problem: [The core question they need to answer]"
      
      Make it open-ended and difficult.
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      setChatHistory([{ role: 'assistant', content: text }]);
    } catch (e) {
      setChatHistory([{ role: 'assistant', content: "Error starting interview. Check API Key." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleChatSubmit = async () => {
    if (!userAnswer.trim() || !apiKey) return;
    
    const newHistory = [...chatHistory, { role: 'user', content: userAnswer } as ChatMessage];
    setChatHistory(newHistory);
    setUserAnswer('');
    setIsChatLoading(true);

    const context = newHistory.slice(-6).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

    const prompt = `
      You are a Mock PM Interviewer. The user just replied to your question.
      Conversation Context: ${context}
      Task:
      1. Briefly validate their answer (point out 1 good thing and 1 missing thing).
      2. Ask a follow-up question to dig deeper into a specific area.
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      setChatHistory([...newHistory, { role: 'assistant', content: text }]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsChatLoading(false);
    }
  };

  // --- Views ---

  const renderDashboard = () => {
    const avgScore = history.length > 0 ? (history.reduce((acc, curr) => acc + curr.score, 0) / history.length).toFixed(1) : '-';
    
    const categoryScores: Record<string, {total: number, count: number}> = {};
    history.forEach(h => {
      if (!categoryScores[h.type]) categoryScores[h.type] = { total: 0, count: 0 };
      categoryScores[h.type].total += h.score;
      categoryScores[h.type].count += 1;
    });

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
          <h1 className="text-2xl font-bold mb-2">Welcome to PM Gym</h1>
          <p className="opacity-90">Daily reps build product muscle. Ready for your set?</p>
          <div className="flex gap-4 mt-6">
            <div className="bg-white/20 backdrop-blur-md rounded-lg p-3 px-4">
              <div className="text-xs opacity-75 uppercase font-medium">Avg Score</div>
              <div className="text-2xl font-bold">{avgScore}</div>
            </div>
            <div className="bg-white/20 backdrop-blur-md rounded-lg p-3 px-4">
              <div className="text-xs opacity-75 uppercase font-medium">Sessions</div>
              <div className="text-2xl font-bold">{history.length}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button 
            onClick={() => { setView('drill'); generateQuestion(); }}
            className="group relative bg-white border border-gray-200 p-6 rounded-xl hover:shadow-lg transition-all text-left overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Zap className="w-24 h-24 text-indigo-600 -rotate-12 transform translate-x-4 -translate-y-4" />
            </div>
            <div className="relative z-10">
              <div className="bg-indigo-100 w-10 h-10 rounded-lg flex items-center justify-center mb-4 text-indigo-600">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Quick Drill</h3>
              <p className="text-sm text-gray-500 mt-1">5 minutes. One random question.</p>
            </div>
          </button>
           <button 
            onClick={startDeepDive}
            className="group relative bg-white border border-gray-200 p-6 rounded-xl hover:shadow-lg transition-all text-left overflow-hidden"
          >
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <BookOpen className="w-24 h-24 text-teal-600 -rotate-12 transform translate-x-4 -translate-y-4" />
            </div>
             <div className="relative z-10">
              <div className="bg-teal-100 w-10 h-10 rounded-lg flex items-center justify-center mb-4 text-teal-600">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Deep Dive</h3>
              <p className="text-sm text-gray-500 mt-1">Interactive mock interview.</p>
            </div>
          </button>
        </div>
        
        {/* Recent History */}
        <div className="space-y-3">
          <h3 className="font-bold text-gray-900 ml-1">Recent Sessions</h3>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500 ml-1">No sessions yet. Start a drill!</p>
          ) : (
            history.slice(0, 3).map((session, idx) => (
              <div key={idx} className="bg-white border border-gray-100 p-4 rounded-lg shadow-sm flex justify-between items-center">
                <div>
                   <div className="flex items-center gap-2 mb-1">
                     <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                       session.type === 'Strategic' ? 'bg-purple-100 text-purple-700' :
                       session.type === 'Metrics' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                     }`}>
                       {session.type}
                     </span>
                     <span className="text-xs text-gray-400">{session.industry}</span>
                   </div>
                   <p className="text-sm text-gray-800 line-clamp-1">{session.question}</p>
                </div>
                <div className={`text-lg font-bold ${session.score >= 8 ? 'text-green-600' : session.score >= 5 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {session.score}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderDrillView = () => {
    return (
       <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => setView('dashboard')} className="text-gray-500 hover:text-gray-900 text-sm flex items-center gap-1">
            <ChevronRight className="w-4 h-4 rotate-180" /> Back to Dashboard
          </button>
           {!feedback && (
             <button onClick={generateQuestion} className="text-indigo-600 text-sm font-medium flex items-center gap-1 hover:underline">
               <RefreshCw className="w-3 h-3" /> Skip Question
             </button>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto pb-24">
           {/* Question Card */}
           <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mb-6">
             <div className="flex gap-2 mb-2">
               <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-bold uppercase">{currentType}</span>
               <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-bold uppercase">{currentIndustry}</span>
             </div>
             <h2 className="text-xl font-serif text-gray-900">{currentQuestion || "Loading..."}</h2>
             
             {!feedback && currentQuestion && (
              <div className="mt-6">
                {hint ? (
                  <div className="bg-amber-50 p-4 rounded-lg text-sm text-amber-800">💡 Hint: {hint}</div>
                ) : (
                  <button onClick={getHint} disabled={isGeneratingHint} className="text-amber-600 text-sm flex items-center gap-1 font-medium">
                    <Lightbulb className="w-4 h-4" /> Get Hint
                  </button>
                )}
              </div>
            )}
           </div>

           {/* Feedback */}
           {feedback && (
             <div className="bg-gray-900 text-white rounded-2xl p-6 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-yellow-400">Feedback</h3>
                  <div className="text-2xl font-bold">{feedback.score}/10</div>
                </div>
                <div className="space-y-2 text-sm text-gray-300">
                  <p><strong>Analysis:</strong> {feedback.feedback}</p>
                  <p><strong>Level Up:</strong> {feedback.levelUp}</p>
                </div>
                <div className="flex gap-3 mt-6">
                   <button onClick={() => { setFeedback(null); generateQuestion(); }} className="flex-1 bg-white text-gray-900 py-2 rounded-lg font-bold">Next</button>
                   <button onClick={generateChallenge} disabled={!!stakeholderChallenge} className="flex-1 border border-gray-600 text-white py-2 rounded-lg">Challenge Me</button>
                </div>
             </div>
           )}

           {stakeholderChallenge && (
             <div className="bg-red-50 border border-red-100 p-4 rounded-xl mt-4 text-red-900">
               <strong>Stakeholder asks:</strong> "{stakeholderChallenge}"
             </div>
           )}
        </div>

        {/* Input */}
        {!feedback && (
           <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200">
             <div className="max-w-2xl mx-auto relative">
               <textarea 
                 value={userAnswer}
                 onChange={(e) => setUserAnswer(e.target.value)}
                 className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 pr-12 h-32"
                 placeholder="Type answer..."
               />
               <button onClick={submitAnswer} disabled={isLoading} className="absolute bottom-4 right-4 bg-indigo-600 text-white p-2 rounded-lg">
                 <Send className="w-4 h-4" />
               </button>
             </div>
           </div>
        )}
       </div>
    );
  };

  const renderDeepDiveView = () => {
    return (
       <div className="h-full flex flex-col bg-gray-50">
         <div className="bg-white border-b p-4 flex justify-between sticky top-0">
           <button onClick={() => setView('dashboard')} className="text-sm text-gray-500">Exit Interview</button>
           <div className="font-bold text-teal-700">Mock Interview</div>
         </div>
         <div className="flex-1 overflow-y-auto p-4 space-y-4">
           {chatHistory.map((m, i) => (
             <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
               <div className={`max-w-[85%] p-3 rounded-xl ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border'}`}>
                 {m.content}
               </div>
             </div>
           ))}
           <div ref={chatEndRef}></div>
         </div>
         <div className="p-4 bg-white border-t">
            <div className="max-w-2xl mx-auto relative">
              <textarea 
                value={userAnswer} 
                onChange={e => setUserAnswer(e.target.value)}
                className="w-full bg-gray-50 p-3 pr-12 rounded-xl h-14"
                placeholder="Reply..."
              />
              <button onClick={handleChatSubmit} disabled={isChatLoading} className="absolute bottom-3 right-3 text-teal-600">
                <Send className="w-5 h-5" />
              </button>
            </div>
         </div>
       </div>
    );
  };

  if (!auth) return <div className="p-10 text-center">Loading Configuration...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20 md:pb-0">
      <div className="max-w-2xl mx-auto min-h-screen bg-white shadow-xl overflow-hidden flex flex-col">
        <header className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white z-10 sticky top-0">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('dashboard')}>
            <div className="bg-indigo-600 text-white p-1.5 rounded-lg"><Briefcase className="w-5 h-5" /></div>
            <span className="font-bold text-lg tracking-tight">PM Gym</span>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <Settings className="w-5 h-5 text-gray-500" />
          </button>
        </header>
        <main className="flex-1 overflow-hidden flex flex-col">
          {view === 'dashboard' && <div className="p-6 overflow-y-auto h-full">{renderDashboard()}</div>}
          {view === 'drill' && <div className="h-full">{renderDrillView()}</div>}
          {view === 'deep-dive' && <div className="h-full">{renderDeepDiveView()}</div>}
        </main>
      </div>
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        setApiKey={setApiKey}
        industries={selectedIndustries}
        setIndustries={setSelectedIndustries}
      />
    </div>
  );
}