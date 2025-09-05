# PostgreSQL Web Manager

A modern, responsive web-based PostgreSQL database management tool built with Node.js and Express.

## Features

- 🗄️ **Table Management** - View, edit, and manage database tables
- 🔍 **Advanced Search** - Filter and search through table data
- ✏️ **Inline Editing** - Edit table cells directly in the interface
- 📊 **Database Statistics** - View database size, table counts, and more
- 📝 **SQL Query Console** - Execute custom SQL queries with syntax highlighting
- 📤 **Data Export** - Export table data to CSV format
- 🎨 **Modern UI** - Clean, responsive interface with dark mode support
- 🔒 **Secure** - SSL support for production environments

## Screenshots

![Dashboard](screenshots/dashboard.png)
![Table View](screenshots/table-view.png)

## Installation

### Prerequisites
- Node.js (v14 or higher)
- PostgreSQL database
- npm or yarn

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/cloudsoftwareoff/postgresql_manager.git
   cd postgresql_manager
   ```

2. Install dependencies
    ```bash
    npm install
    ```

3. Configure environment
    ```
    cp .env.example .env
    ```
Edit .env with your database credentials.


4. Start the application
    ```bash
    npm start
    ```
    or 
    ```bash
    npm run dev
    ```
    