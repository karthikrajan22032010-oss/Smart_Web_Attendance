# Use Python base image
FROM python:3.9-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

# Set the working directory
WORKDIR /app

# Install system dependencies for OpenCV headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements.txt and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all project files into the container
COPY . .

# Create required directories
RUN mkdir -p /app/known_faces /app/databases /app/attendance_data /app/recordings

# Expose the port Render uses
EXPOSE 8080

# Command to run the application
CMD ["python", "app.py"]
