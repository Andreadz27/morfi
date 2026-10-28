@echo off
:: Nombre anterior (Morfi). Las PCs instaladas antes del cambio a Fadido tienen la tarea de inicio apuntando acá:
:: sigue funcionando y arranca lo mismo. Al volver a correr instalar.ps1, la tarea pasa a iniciar-fadido.bat.
call "%~dp0iniciar-fadido.bat" %*
