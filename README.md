# 📚 Course Tracker Community Library

Welcome to the **Course Tracker Community Library**! This repository hosts user-created courses for [Course Tracker](https://github.com/pandeysuryansh921-wq/course-tracker), an offline, local-first web application for self-learners.

By keeping this repository separate from the main application code, we keep the main application fast and lightweight while allowing the community to grow endlessly!

## 🚀 How to Download a Course

**You don't need to manually download anything here!**
Simply open your Course Tracker application, go to **Settings > Import Course > Browse Community Library**, and click **Download & Enroll**. The app will automatically fetch the course from this repository and load it directly into your local database.

## 🤝 How to Contribute a Course

Want to share a course you've created with the community? It's easy!

1. Open the Course Tracker app and go to **Settings > Export Course**.
2. Select your course and click **Export**. This will generate a `.zip` file (all your personal progress and scores are automatically stripped out so it's fresh for others).
3. **Fork** this repository.
4. Upload your exported `.zip` file to the root of this repository.
5. Edit the `courses.json` file to add your course details to the list. Use this format:
   ```json
   {
     "id": "a-unique-id",
     "title": "Your Course Title",
     "author": "Your Name/Username",
     "description": "A short description of what people will learn.",
     "filename": "your-course-file.zip"
   }
   ```
6. Submit a **Pull Request**. Once approved, your course will instantly become available inside the Course Tracker app for everyone!
