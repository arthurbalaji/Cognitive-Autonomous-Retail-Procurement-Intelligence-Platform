# syntax=docker/dockerfile:1.7
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -q -B dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -q -B -DskipTests package

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /src/target/carpip-backend.jar app.jar
ENV JAVA_TOOL_OPTIONS="-Xms192m -Xmx384m -XX:MaxMetaspaceSize=160m -XX:+UseSerialGC -Xss512k -XX:TieredStopAtLevel=1 -Duser.timezone=UTC"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
