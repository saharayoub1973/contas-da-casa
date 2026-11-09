// Configuração do Firebase do projeto contas-da-casa
export const firebaseConfig = {
  apiKey: "AIzaSyB56T1Yq4_jt8igHvprhPT6f9pTyYU5E3g",
  authDomain: "contas-da-casa-675d2.firebaseapp.com",
  projectId: "contas-da-casa-675d2",
  storageBucket: "contas-da-casa-675d2.firebasestorage.app",
  messagingSenderId: "489601270424",
  appId: "1:489601270424:web:f1fbc68d8f0e3c01b846ed"
};

// E-mails que podem entrar no app (os mesmos das regras do Firestore)
export const emailsPermitidos = [
  "saharayoub@gmail.com",
  "simoneayoub@gmail.com"
];

// 3) Chave de notificações: Firebase → Configurações do projeto → Cloud Messaging →
//    Certificados push da Web → Gerar par de chaves → copie a chave e cole aqui
export const vapidKey = "COLE_A_CHAVE_AQUI";
