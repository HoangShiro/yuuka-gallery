// Maid-chan Settings: Avatar upload UI
(function(){
  function init(root){
    if(!root) return;
    const fileInput = root.querySelector('.maid-chan-upload-input');
    const uploadBtn = root.querySelector('.maid-chan-upload-btn');
    const statusEl = root.querySelector('.maid-chan-upload-status');
    const previewImg = root.querySelector('.maid-chan-upload-preview img');
    const previewBox = root.querySelector('.maid-chan-upload-preview');

    let selectedFile = null;

    // Seed preview from current maid image if available
    const currentUrl = window.Yuuka?.plugins?.maidChanInstance?.state?.avatar;
    if(previewImg){ previewImg.src = currentUrl || ''; }

    const setStatus = (msg, isError=false)=>{
      if(!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.classList.toggle('error', !!isError);
    };

    const updateButtonState = ()=>{
      if(!uploadBtn) return;
      uploadBtn.disabled = !selectedFile;
    };

    if(fileInput){
      fileInput.addEventListener('change', ()=>{
        const f = fileInput.files && fileInput.files[0];
        if(f){
          selectedFile = f;
          if(previewImg){ previewImg.src = URL.createObjectURL(f); }
        }
        setStatus('');
        updateButtonState();
      });
    }

    // Click/keyboard on preview to open file picker
    if(previewBox && fileInput){
      previewBox.addEventListener('click', ()=> fileInput.click());
      previewBox.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fileInput.click(); }
      });

      // Drag & drop support on preview
      previewBox.addEventListener('dragover', (e)=>{ e.preventDefault(); previewBox.classList.add('dragover'); });
      previewBox.addEventListener('dragleave', ()=> previewBox.classList.remove('dragover'));
      previewBox.addEventListener('drop', (e)=>{
        e.preventDefault();
        previewBox.classList.remove('dragover');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        const isImage = !!(f && ((f.type && f.type.startsWith('image/')) || (f.name && /(\.png|jpe?g|webp|gif)$/i.test(f.name))));
        if(isImage && f){
          selectedFile = f;
          if(previewImg){ previewImg.src = URL.createObjectURL(f); }
          // Clear input value to avoid confusion about its internal state
          if(fileInput){ fileInput.value = ''; }
          setStatus('');
          updateButtonState();
        } else {
          setStatus('Please drop an image file.', true);
        }
      });
    }

    if(uploadBtn){
      uploadBtn.addEventListener('click', async ()=>{
        if(uploadBtn.disabled) return; // guard
        const f = selectedFile || (fileInput?.files && fileInput.files[0]);
        if(!f){ setStatus('Please choose an image file first.', true); return; }
        setStatus('Saving…');
        uploadBtn.disabled = true;
        const prevLabel = uploadBtn.textContent;
        uploadBtn.textContent = 'Saving…';
        const maid = window.Yuuka?.plugins?.maidChanInstance;
        if(!maid || typeof maid.uploadAvatarFile !== 'function'){
          setStatus('Maid component is not ready. Try again later.', true);
          uploadBtn.textContent = prevLabel;
          updateButtonState();
          return;
        }
        const res = await maid.uploadAvatarFile(f);
        if(res && !res.error){
          setStatus('Avatar saved!');
          selectedFile = null;
          const newUrl = res.avatar_url || maid.state?.avatar;
          if(newUrl && previewImg){ previewImg.src = newUrl; }
          uploadBtn.textContent = 'Saved';
          setTimeout(()=>{ uploadBtn.textContent = 'Save'; }, 1200);
        } else {
          setStatus(res?.error || 'Save failed.', true);
          uploadBtn.textContent = prevLabel;
        }
        updateButtonState();
      });
      // Initialize state
      updateButtonState();
    }

    // Listen for external avatar changes (bubble drop/paste, other modules)
    window.addEventListener('maid-chan:avatar-changed', (e)=>{
      try{
        const url = e.detail?.url;
        const img = root.querySelector('.maid-chan-upload-preview img');
        if(url && img){ img.src = url; }
      }catch(err){ /* ignore */ }
    });
  }

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.components.MaidChanSettings = { init };
})();