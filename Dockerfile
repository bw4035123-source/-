# 정보화사업 이관·서버 배포용(선택). 실행: docker build -t baton . && docker run -p 8765:8765 baton
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8765
CMD ["python", "run.py", "--host", "0.0.0.0", "--no-browser"]
