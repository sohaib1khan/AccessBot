FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our nginx config into the image — no bind mount needed
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy all frontend static files
COPY frontend/ /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
