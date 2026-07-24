import "./App.css";

function App() {
  return (
    <div className="app">

      {/* ================= MAIN CONTENT ================= */}

      <div className="main-content">

        {/* Header */}

        <div className="header">
          <div className="header-info">
            <div className="logo">🤖</div>

            <div>
              <h2>AI Chatbot</h2>
              <p>Online • Ready to Assist</p>
            </div>
          </div>
        </div>

        {/* Chat Area */}

        <div className="chat-area">

          <div className="message ai-message">
            <div className="message-content">
              <span className="time">10:21 AM</span>
              <p>
                👋 Hello! I'm your AI assistant.
                How can I help you today?
              </p>
            </div>
          </div>

          <div className="message user-message">
            <div className="message-content">
              <span className="time">10:22 AM</span>
              <p>Can you explain what SigNoz is?</p>
            </div>
          </div>

          <div className="message ai-message">
            <div className="message-content">
              <span className="time">10:22 AM</span>
              <p>
                SigNoz is an open-source observability platform used for
                monitoring metrics, traces and logs from applications.
              </p>
            </div>
          </div>

        </div>

        {/* Input */}

        <div className="input-area">

          <button className="tool-btn">📎</button>

          <button className="tool-btn">😊</button>

          <input
            type="text"
            placeholder="Message AI Chatbot..."
          />

          <button className="tool-btn">🎤</button>

          <button className="tool-btn">✨</button>

          <button className="send-btn">➤</button>

        </div>

      </div>

      {/* ================= SIDEBAR ================= */}

      <div className="sidebar">

        <div className="sidebar-header">
          <button className="new-chat">
            + New Chat
          </button>
        </div>

        <div className="sidebar-body">

          <h4 className="history-title">History</h4>

          <div className="history-item active">
            💬 SigNoz Overview
          </div>

          <div className="history-item">
            📈 Dashboard Metrics
          </div>

          <div className="history-item">
            ⚠ Error Monitoring
          </div>

          <div className="history-item">
            📊 CPU Usage
          </div>

        </div>

        <div className="sidebar-footer">
  <button className="settings-btn">
    ⚙️ Settings
  </button>
</div>

      </div>

    </div>
  );
}

export default App;