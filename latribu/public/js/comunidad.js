// Wait for DOM to load
document.addEventListener('DOMContentLoaded', function() {
  // Initialize components
  initAvatarUpload();
  initPostEditor();
  initPostPhotoUpload();
  loadUserData();
  verificarSesion();
});

// DOM Elements
const pageLoader = document.getElementById('pageLoader');
const comunidadAvatarCircle = document.getElementById('comunidadAvatarCircle');
const comunidadAvatarSmall = document.getElementById('comunidadAvatarSmall');
const comunidadNombre = document.getElementById('comunidadNombre');
const comunidadTitulo = document.getElementById('comunidadTitulo');
const comunidadChips = document.getElementById('comunidadChips');
const comunidadFotoInput = document.getElementById('comunidadFoto');
const comunidadPostEditor = document.getElementById('comunidadPostEditor');
const comunidadPostBtn = document.getElementById('comunidadPostBtn');
const comunidadFotoBtn = document.getElementById('comunidadFotoBtn');
const comunidadPostFotoInput = document.getElementById('comunidadPostFoto');
const comunidadPostInput = document.getElementById('comunidadPostInput');
const comunidadPostFilename = document.getElementById('comunidadPostFilename');
const comunidadPostClearBtn = document.getElementById('comunidadPostClearBtn');
const comunidadPostMsg = document.getElementById('comunidadPostMsg');

// State
let waPostEditor = null;
let selectedPostPhoto = null;
let userData = null;

// Initialize avatar upload functionality
function initAvatarUpload() {
  // Click on avatar to open file picker
  comunidadAvatarCircle.addEventListener('click', function() {
    comunidadFotoInput.click();
  });
  
  // Handle file selection
  comunidadFotoInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      // Show preview
      const reader = new FileReader();
      reader.onload = function(event) {
        comunidadAvatarCircle.innerHTML = `<img src="${event.target.result}" alt="Avatar">`;
        comunidadAvatarSmall.innerHTML = `<img src="${event.target.result}" alt="Avatar">`;
      };
      reader.readAsDataURL(file);
      
      // In a real app, you would upload this to the server here
      showMessage('Foto seleccionada. En una implementación completa, se subiría al servidor.', 'info');
    }
  });
}

// Initialize WhatsApp-style editor for post creation
function initPostEditor() {
  if (waPostEditor) return;
  waPostEditor = WaEditor.create(comunidadPostEditor, {
    placeholder: 'Comparte algo con la comunidad...',
  });
}

// Initialize post photo upload functionality
function initPostPhotoUpload() {
  comunidadFotoBtn.addEventListener('click', function() {
    comunidadPostFotoInput.click();
  });
  
  comunidadPostFotoInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      // Validate file type and size (basic check)
      if (!file.type.match('image.*')) {
        showMessage('Por favor selecciona un archivo de imagen válido', 'error');
        return;
      }
      
      // Show filename
      comunidadPostFilename.value = file.name;
      selectedPostPhoto = file;
      comunidadPostInput.style.display = 'flex';
      
      showMessage(`Foto seleccionada: ${file.name}`, 'success');
    }
  });
  
  comunidadPostClearBtn.addEventListener('click', function() {
    comunidadPostFotoInput.value = '';
    comunidadPostFilename.value = '';
    selectedPostPhoto = null;
    comunidadPostInput.style.display = 'none';
    showMessage('Foto eliminada', 'info');
  });
}

// Load user data from API
async function loadUserData() {
  const loaderText = document.getElementById('pageLoaderText');
  if (loaderText) loaderText.textContent = 'Cargando perfil...';
  showLoader(true);
  
  try {
    const response = await tribuFetch('/tribu-auth/me');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const user = await response.json();
    userData = user;
    displayUserData();
    
  } catch (error) {
    console.error('Error loading user data:', error);
    showMessage('Error al cargar los datos del usuario. Por favor intenta de nuevo.', 'error');
  } finally {
    showLoader(false);
  }
}

// Display user data in the UI
function displayUserData() {
  if (!userData) return;
  // Parse intereses and objetivos if they are strings
  if (typeof userData.intereses === 'string') {
    try {
      userData.intereses = JSON.parse(userData.intereses);
    } catch (e) {
      console.warn('Failed to parse intereses', e);
      userData.intereses = [];
    }
  } else if (!Array.isArray(userData.intereses)) {
    userData.intereses = [];
  }
  if (typeof userData.objetivos === 'string') {
    try {
      userData.objetivos = JSON.parse(userData.objetivos);
    } catch (e) {
      console.warn('Failed to parse objetivos', e);
      userData.objetivos = [];
    }
  } else if (!Array.isArray(userData.objetivos)) {
    userData.objetivos = [];
  }
  
  // Update name
  const nombreCompleto = `${userData.nombre || ''} ${userData.apellido || ''}`.trim();
  comunidadNombre.textContent = nombreCompleto || 'Usuario';
  comunidadTitulo.textContent = 'Mi perfil en la comunidad';
  
// Update avatar
   if (userData.foto_url) {
     const avatarImg = `<img src="${userData.foto_url}" alt="Avatar de ${userData.nombre}">`;
     comunidadAvatarCircle.innerHTML = avatarImg;
     comunidadAvatarSmall.innerHTML = avatarImg;
   } else {
     // Show initials
     const nombreFirst = userData.nombre && userData.nombre.length > 0 ? userData.nombre[0] : '';
     const apellidoFirst = userData.apellido && userData.apellido.length > 0 ? userData.apellido[0] : '';
     const initials = (nombreFirst + apellidoFirst).toUpperCase() || '?';
     comunidadAvatarCircle.textContent = initials;
     comunidadAvatarSmall.textContent = initials;
   }
  
  // Update chips (intereses and objetivos)
  updateChips();
}

// Update intereses and objetivos chips
function updateChips() {
  comunidadChips.innerHTML = '';
  
  // Add intereses chips
  if (userData.intereses && Array.isArray(userData.intereses)) {
    userData.intereses.forEach(interes => {
      if (interes && interes.trim() !== '') {
        const chip = document.createElement('div');
        chip.className = 'comunidad-chip';
        chip.innerHTML = `<span class="comunidad-chip-icon">🎯</span> ${interes.trim()}`;
        comunidadChips.appendChild(chip);
      }
    });
  }
  
  // Add objetivos chips
  if (userData.objetivos && Array.isArray(userData.objetivos)) {
    userData.objetivos.forEach(objetivo => {
      if (objetivo && objetivo.trim() !== '') {
        const chip = document.createElement('div');
        chip.className = 'comunidad-chip';
        chip.innerHTML = `<span class="comunidad-chip-icon">🏆</span> ${objetivo.trim()}`;
        comunidadChips.appendChild(chip);
      }
    });
  }
  
// If no chips, show a message
    if (comunidadChips.children.length === 0) {
      const noChips = document.createElement('div');
      noChips.className = 'comunidad-chip';
      noChips.style.color = 'var(--muted)';
      noChips.textContent = 'Aún no tienes intereses u objetivos definidos. Ve a tu perfil para agregarlos.';
      comunidadChips.appendChild(noChips);
    }
}

// Show/hide loader
function showLoader(show) {
  if (show) {
    pageLoader.classList.add('show');
  } else {
    pageLoader.classList.remove('show');
  }
}

// Show message in post section
function showMessage(message, type = 'info') {
  comunidadPostMsg.textContent = message;
  comunidadPostMsg.className = `comunidad-post-msg ${type}`;
  comunidadPostMsg.style.display = 'block';
  
  // Hide after 5 seconds for success/info messages
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      comunidadPostMsg.style.display = 'none';
    }, 5000);
  }
}

// Handle post submission
comunidadPostBtn.addEventListener('click', async function() {
  const content = waPostEditor ? waPostEditor.getValue().trim() : '';

  if (!content) {
    showMessage('Por favor escribe algo antes de publicar', 'error');
    return;
  }
  
  showLoader(true);
  
  try {
    // In a real implementation, you would send this to your backend
    // For now, we'll just simulate success
    
    const postData = {
      content: content,
      photo: selectedPostPhoto ? {
        filename: selectedPostPhoto.name,
        type: selectedPostPhoto.type,
        // In a real app, you would upload the file and store the URL
      } : null
    };
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Clear form
    waPostEditor.setValue('');
    comunidadPostFotoInput.value = '';
    comunidadPostFilename.value = '';
    selectedPostPhoto = null;
    comunidadPostInput.style.display = 'none';
    
    showMessage('¡Publicación compartida con la comunidad!', 'success');
    
  } catch (error) {
    console.error('Error creating post:', error);
    showMessage('Error al publicar. Por favor intenta de nuevo.', 'error');
  } finally {
    showLoader(false);
  }
});