# Custom WordPress 7.0 image with the ThermExpertise theme baked in.
#
# Build & push (CI or locally):
#   docker build -f deploy/docker/Dockerfile \
#     --build-arg WORDPRESS_VERSION=7.0 \
#     -t ghcr.io/narongwile/thermexpertise-wordpress:7.0 .
#   docker push ghcr.io/narongwile/thermexpertise-wordpress:7.0
#
# NOTE: WordPress 7.0 may not yet be published on Docker Hub. If the tag below
# does not resolve, set --build-arg WORDPRESS_VERSION to the newest available
# release (e.g. 6.8) — the theme is forward-compatible.
ARG WORDPRESS_VERSION=7.0
FROM wordpress:${WORDPRESS_VERSION}-php8.3-apache

# Bake the custom theme into the image so it is managed via Git/CI, not the PVC.
# The official entrypoint copies /usr/src/wordpress -> /var/www/html on first
# boot; placing the theme here keeps it versioned and immutable.
COPY wordpress/wp-content/themes/thermexpertise \
     /usr/src/wordpress/wp-content/themes/thermexpertise

# Activate the theme automatically on a fresh install (optional helper script).
COPY deploy/docker/activate-theme.sh /docker-entrypoint-init.d/activate-theme.sh

RUN set -eux; \
    chmod +x /docker-entrypoint-init.d/activate-theme.sh; \
    chown -R www-data:www-data /usr/src/wordpress/wp-content/themes/thermexpertise

# Recommended PHP opcache settings for production.
RUN { \
      echo 'opcache.memory_consumption=128'; \
      echo 'opcache.max_accelerated_files=10000'; \
      echo 'opcache.revalidate_freq=60'; \
      echo 'opcache.enable=1'; \
    } > /usr/local/etc/php/conf.d/opcache-recommended.ini
