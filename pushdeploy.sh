#!/bin/bash
git add .
git commit -m "$1"
git push
echo "📦 Push hecho. Lanzando redeploy en Vercel..."
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_blcktxqj31thM0RISpMX8jlfMj4T/M2GWHNeXIe"
#!/bin/bash
git add .
git commit -m "$1"
git push
echo "📦 Push hecho. Lanzando redeploy en Vercel..."
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_blcktxqj31thM0RISpMX8jlfMj4T/M2GWHNeXIe"
