export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  lastMessage: string;
  updatedAt: any; // Firestore Timestamp
  createdAt: any; // Firestore Timestamp
}

export interface Message {
  id?: string;
  conversationId: string;
  sender: 'user' | 'ai';
  text: string;
  imageUrl?: string;
  ocrText?: string;
  timestamp: any; // Firestore Timestamp
}

export interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  loading: boolean;
  error: string | null;
}
