:: --- NEW FILE: INSTALL.bat ---
@echo off
echo Installing/Updating required Python libraries for Character Gallery...
echo.

:: Tự động tìm pip trong môi trường python
py -m pip install --upgrade pip
echo.

echo Installing from requirements.txt...
py -m pip install -r requirements.txt
echo.

echo.
echo ===============================================================
echo Installation complete!
echo You can now close this window and run RUN.bat to start the app.
echo ===============================================================
echo.
pause