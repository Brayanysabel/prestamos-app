@echo off
SET "JAVA_HOME=C:\Program Files\Android\jdk\jdk-8.0.302.8-hotspot\jdk8u302-b08"
SET "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "c:\Users\a.ysabel\Desktop\app de restamos\android"
echo Building APK...
call gradlew.bat assembleDebug
echo Build finished with code: %ERRORLEVEL%
