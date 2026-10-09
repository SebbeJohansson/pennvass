# LanguageTool from its official release zip, so the only code in the image is
# LanguageTooler's and Eclipse Temurin's Java. Build and run:
#
#   docker build -t pennvass-languagetool docker/languagetool
#   docker run -d --name languagetool -p 127.0.0.1:8010:8010 pennvass-languagetool
#
# LanguageTool publishes no checksum, so LT_SHA256 is the hash of the zip as
# downloaded on 2026-10-09. A zip that changes after that fails the build.
# To upgrade, set LT_VERSION, then LT_SHA256 to `sha256sum` of the new zip.

FROM alpine:3.20 AS download
ARG LT_VERSION=6.6
ARG LT_SHA256=53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631
RUN wget -q -O /lt.zip "https://languagetool.org/download/LanguageTool-${LT_VERSION}.zip" \
 && echo "${LT_SHA256}  /lt.zip" | sha256sum -c - \
 && unzip -q /lt.zip -d / \
 && mv "/LanguageTool-${LT_VERSION}" /languagetool

FROM eclipse-temurin:21-jre
COPY --from=download /languagetool /languagetool
USER nobody
WORKDIR /languagetool
EXPOSE 8010
# --public listens on all of the container's interfaces; publish the port on
# 127.0.0.1 only (as above) so nothing outside this machine reaches it.
CMD ["java", "-Xmx1g", "-cp", "languagetool-server.jar", "org.languagetool.server.HTTPServer", "--port", "8010", "--public"]
