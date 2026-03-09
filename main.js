//  main.js
// Acil durum sahnesini oluşturur. Parser'dan gelen veriyi alır, spatial knowledge base ile düzeltir ve sahneye yerleştirir. 


//--- SPATIAL KNOWLEDGE BASE ---
// Bu veritabanı gerçek dünya obje ilişkilerini saklar ve LLM hatalarını düzeltir
fetch('http://127.0.0.1:8000/api/new-session', { method: 'POST' })
    .catch(() => {});

const SPATIAL_KNOWLEDGE = {

    // 1. SUPPORT HIERARCHY
    support_hierarchy: {
        "lamp":      { can_be_on: ["nightstand", "table", "desk"], must_be_supported: true },
        "book":      { can_be_on: ["table", "desk", "bookshelf"],  must_be_supported: false },
        "first_aid": { can_be_on: ["table", "desk", "nightstand"], must_be_supported: false },
    },

    // 2. CORRECT RELATIONS
    correct_relations: {
        "chair":      { with: "table", correct: ["in_front_of", "next_to"], incorrect: ["behind", "on"] },
        "nightstand": { with: "bed",   correct: ["left_of", "right_of"],   incorrect: ["behind", "in_front_of", "on"] },
    },

    // 3. PREFERRED PLACEMENT
    preferred_placement: {
        "bed":               { avoid_center: true,  preferred_wall: "behind" },
        "sofa":              { avoid_center: true,  preferred_wall: "behind" },
        "couch":             { avoid_center: true,  preferred_wall: "behind" },
        "closet":            { avoid_center: true,  preferred_wall: "right"  },
        "wardrobe":          { avoid_center: true,  preferred_wall: "left"   },
        "desk":              { avoid_center: false, preferred_wall: "left"   },
        "table":             { avoid_center: false, preferred_wall: "left"   },
        "rubble":            { avoid_center: false },
        "debris":            { avoid_center: false },
        "fire_extinguisher": { avoid_center: false },
    },

    // 4. FORBIDDEN NEIGHBORS
    forbidden_neighbors: {
        "bed":               ["table", "desk", "rubble", "debris"],
        "rubble":            ["bed", "table", "nightstand", "sofa"],
        "debris":            ["bed", "table", "nightstand"],
        "fire_extinguisher": ["rubble", "debris"],
    },

    // 5. TRAVERSABILITY MAP
    traversability_map: {
        "door":             "blocked",
        "window":           "blocked",
        "wall":             "blocked",
        "broken_wall":      "blocked",
        "concrete":         "blocked",
        "table":            "blocked",
        "desk":             "blocked",
        "closet":           "blocked",
        "wardrobe":         "blocked",
        "bookshelf":        "blocked",
        "tv":               "blocked",
        "nightstand":       "blocked",
        "stretcher":        "blocked",
        "bed":              "walkable_over",
        "sofa":             "walkable_over",
        "couch":            "walkable_over",
        "armchair":         "walkable_over",
        "chair":            "passable",
        "lamp":             "passable",
        "first_aid":        "passable",
        "fire_extinguisher":"passable",
        "oxygen_tank":      "passable",
        "wheelchair":       "passable",
        "injured":          "passable",
        "person":           "passable",
        "victim":           "passable",
        "rubble":           "blocked",
        "debris":           "blocked",
        "obstacle":         "blocked",
    },

    // 6. PLACEMENT TYPE MAP
    placement_type_map: {
        floor: [
            "bed", "sofa", "couch", "chair", "armchair", "table", "desk",
            "closet", "wardrobe", "bookshelf", "nightstand", "tv",
            "rubble", "debris", "concrete", "broken_wall", "obstacle",
            "stretcher", "wheelchair", "first_aid", "fire_extinguisher",
            "extinguisher", "oxygen_tank", "injured", "person", "victim", "lamp",
        ],
        wall: [
            "door", "window",
        ],
    },
};

// --- INFERENCE ENGINE (SceneSeer Algoritması) ---
// Bu fonksiyon LLM çıktısını Spatial Knowledge Base ile düzeltir

function applySpatialInference(sceneData) {
    console.log("🧠 [SceneSeer] Spatial Inference başlatılıyor...");
    
    const { assets, relations } = sceneData;
    let correctedRelations = [...relations];
    
    // 1. SUPPORT HIERARCHY
    assets.forEach(asset => {
        const supportInfo = SPATIAL_KNOWLEDGE.support_hierarchy[asset.type];
        
        if (supportInfo && supportInfo.must_be_supported) {
            const myRelation = relations.find(r => r.source_id === asset.id);
            
            // "on" ilişkisi yoksa otomatik ekle
            if (!myRelation || !myRelation.relation.includes("on")) {
                // Uygun destek objesi bul
                const supportObject = assets.find(a => 
                    supportInfo.can_be_on.includes(a.type)
                );
                
                if (supportObject) {
                    console.log(` Spatial knowledge ile ${asset.type} otomatik olarak ${supportObject.type} üzerine yerleştirildi`);
                    
                    // Eski ilişkiyi kaldır
                    correctedRelations = correctedRelations.filter(r => r.source_id !== asset.id);
                    
                    // Yeni "on" ilişkisi ekle
                    correctedRelations.push({
                        source_id: asset.id,
                        relation: "on",
                        target_id: supportObject.id
                    });
                }
            }
        }
    });
    
    // 2. CORRECT RELATIONS
    assets.forEach(asset => {
        const preference = SPATIAL_KNOWLEDGE.preferred_placement[asset.type];
        
        if (preference && preference.avoid_center) {
            const myRelation = correctedRelations.find(r => 
                r.source_id === asset.id && r.target_id === "room"
            );
            
            // Eğer "center" konumunda ama olmaması gerekiyorsa düzelt
            if (myRelation && myRelation.relation.includes("center")) {
                console.log(` Spatial knowledge ile ${asset.type} merkeze konmuş → ${preference.preferred_wall} duvarına taşınıyor`);
                myRelation.relation = preference.preferred_wall;
            }
        }
    });

    // Window/door yön fallback -> LLM "on_wall" üretirse kurtarmak için
    assets.forEach(asset => {
        if (asset.type.includes("window") || asset.type.includes("door")) {
            const rel = correctedRelations.find(r => r.source_id === asset.id);
            if (rel && rel.relation === "on_wall") {
                const inputText = document.getElementById('sentence-input')?.value?.toLowerCase() || "";
                if (inputText.includes("left")) rel.relation = "on_left_wall";
                else if (inputText.includes("right")) rel.relation = "on_right_wall";
                else if (inputText.includes("back") || inputText.includes("behind")) rel.relation = "on_back_wall";
                else if (inputText.includes("front")) rel.relation = "on_front_wall";
                else rel.relation = "on_back_wall";
                console.log(` [Fallback] ${asset.type} on_wall => ${rel.relation} duzeltildi`);
            }
        }
    });
    
    // 3. PREFERRED PLACEMENT
    correctedRelations.forEach(rel => {
        const sourceAsset = assets.find(a => a.id === rel.source_id);
        const targetAsset = assets.find(a => a.id === rel.target_id);
        
        if (sourceAsset && targetAsset) {
            // Sandalye, masanın yanına taşınır.
            if (sourceAsset.type.includes("chair") && targetAsset.type.includes("table")) {
                if (rel.relation.includes("behind") || rel.relation.includes("on")) {
                    console.log(`Spatial knowledge-> Sandalye masanın yanlış yerinden YANINA taşındı`);
                    rel.relation = "next_to";
                }
            }
            
            // Genel kurallar
            const ruleInfo = SPATIAL_KNOWLEDGE.correct_relations[sourceAsset.type];
            
            if (ruleInfo && ruleInfo.with === targetAsset.type) {
                // Yanlış ilişki mi kontrol et
                if (ruleInfo.incorrect.some(wrong => rel.relation.includes(wrong))) {
                    console.log(`Spatial knowledge ile ${sourceAsset.type}→${targetAsset.type} yanlış ilişki düzeltildi: "${rel.relation}" → "${ruleInfo.correct[0]}"`);
                    rel.relation = ruleInfo.correct[0];
                }
            }
        }
    });
    
    // 4. FORBIDDEN NEIGHBORS
    correctedRelations.forEach(rel => {
        const sourceAsset = assets.find(a => a.id === rel.source_id);
        const targetAsset = assets.find(a => a.id === rel.target_id);
        
        if (sourceAsset && targetAsset) {
            const forbidden = SPATIAL_KNOWLEDGE.forbidden_neighbors[sourceAsset.type];
            
            if (forbidden && forbidden.includes(targetAsset.type)) {
                console.warn(`! Spatial knowledge-> UYARI: ${sourceAsset.type} ve ${targetAsset.type} yan yana olmamalı!`);
            }
        }
    });

    // 5. TRAVERSABILITY MAP
    const traMap = SPATIAL_KNOWLEDGE.traversability_map;
    assets.forEach(asset => {
        let correctTra = null;
        // Tam eşleşme
        if (traMap[asset.type] !== undefined) {
            correctTra = traMap[asset.type];
        } else {
            // Kısmi eşleşme: window_broken → window
            for (const [key, val] of Object.entries(traMap)) {
                if (asset.type.includes(key)) {
                    correctTra = val;
                    break;
                }
            }
        }
        if (correctTra && asset.traversability !== correctTra) {
            console.log(`[K5] ${asset.type} traversability: ${asset.traversability} → ${correctTra}`);
            asset.traversability = correctTra;
        }
    });

    // 6. PLACEMENT TYPE MAP
    const floorTypes = SPATIAL_KNOWLEDGE.placement_type_map.floor;
    const wallTypes  = SPATIAL_KNOWLEDGE.placement_type_map.wall;
    assets.forEach(asset => {
        let correctPt = null;
        const atype = asset.type;
        if (floorTypes.some(t => atype === t || atype.includes(t))) {
            correctPt = "floor";
        } else if (wallTypes.some(t => atype === t || atype.includes(t))) {
            correctPt = "wall";
        }
        if (correctPt && asset.placement_type !== correctPt) {
            console.log(`[K6] ${asset.type} placement_type: ${asset.placement_type} → ${correctPt}`);
            asset.placement_type = correctPt;
        }
    });
    
    console.log("√ Inference tamamlandı, düzeltilmiş ilişkiler:", correctedRelations);
    return { assets, relations: correctedRelations };
}

let scene, camera, renderer, controls, loader;

// --- 1. BAŞLANGIÇ & SAHNE KURULUMU ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xBAE1FF);
    
    const panelWidth = 400;
    camera = new THREE.PerspectiveCamera(60, (window.innerWidth - panelWidth) / window.innerHeight, 0.1, 1000);

    // Kamera pozisyonu - isometric açı
    camera.position.set(0, 12, 15); // Y: Yükseklik, Z: Geriye uzaklık

    // Kamera odanın merkezine bakıyor
    camera.lookAt(0, 0, 0);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true }); 
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth - panelWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; 
    document.body.appendChild(renderer.domElement);

    // Işıklandırma
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemisphereLight);


    // Kontroller
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0); // Odanın tam merkezi (0,0,0)
    controls.minDistance = 10;    // Minimum zoom mesafesi
    controls.maxDistance = 30;    // Maximum zoom mesafesi
    controls.maxPolarAngle = Math.PI / 2.2; // Çok aşağı inmesin
    controls.update();

    // Texture
    const textureLoader = new THREE.TextureLoader();
    //const woodTexture = textureLoader.load('https://threejs.org/examples/textures/hardwood2_diffuse.jpg');
    const woodTexture = textureLoader.load('./parquet.jpg');
    woodTexture.wrapS = THREE.RepeatWrapping;
    woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.repeat.set(1,1);

    const wallTexture = textureLoader.load('./wall.jpg'); 
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(1, 1);

    // Zemin
    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({ map: woodTexture, side: THREE.DoubleSide });
    const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    scene.add(groundPlane);

    // Duvar Materyali
    const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTexture, color: 0xF5EEDC, side: THREE.DoubleSide });

    // Duvarlar
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), wallMaterial);
    backWall.position.set(0, 5, -10);
    scene.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), wallMaterial);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-10, 5, 0);
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), wallMaterial);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(10, 5, 0);
    scene.add(rightWall);

    // Model yükleyici
    loader = new THREE.GLTFLoader();
    
    addModel("USER", {
        isGLTF: true,
        path: 'objects/standing_person/person1.glb',
        position: { x: 0, y: 2.5, z: 0 },
        scale: { x: 3, y: 3, z: 3 },
        rotation: { x: Math.PI / 8, y: Math.PI, z: 0 },
        userData: { isUser: true } 
    });

    animate();
}

// --- 2. HİBRİT MODEL EKLEME ---
function addModel(type, options = {}) {
    const position = options.position || { x: 0, y: 0, z: 0 };
    const rotation = options.rotation || { x: 0, y: 0, z: 0 };
    const userData = options.userData || {};
    
    // i) Eğer gltf modeli ise (Kapı, Pencere, İnsan)
    if (options.isGLTF) {
        loader.load(options.path, (gltf) => {
            const model = gltf.scene;
            const scale = options.scale || { x: 1, y: 1, z: 1 };
            
            model.scale.set(scale.x, scale.y, scale.z);
            model.rotation.set(rotation.x, rotation.y, rotation.z);
            model.position.set(position.x, position.y, position.z);
            
            // Etiketleri işle
            model.userData = { ...userData, type: type };

            // Çarpışma Kontrolü (Duvar/Kullanıcı değilse)
            if (position.y < 0.1 && !userData.isWall && !userData.isUser) {
                 const safePos = findSafePosition(model, position);
                 model.position.set(safePos.x, safePos.y, safePos.z);
            }

            scene.add(model);
            console.log(`✨ GLTF Model Eklendi: ${type}`);
        }, undefined, (err) => console.error(err));
    } 
    
    // ii) Eğer kutu ise (Mobilyalar)
    else {
        const dimensions = options.dimensions || { w: 1, h: 1, d: 1 };
        const color = options.color || 0x888888;

        const geometry = new THREE.BoxGeometry(dimensions.w, dimensions.h, dimensions.d);
        const labelTexture = createLabelTexture(type); // Üzerine yazı yaz
        
        const material = new THREE.MeshStandardMaterial({ 
            map: labelTexture,
            color: color,
            roughness: 0.3,
            metalness: 0.1
        });

        const model = new THREE.Mesh(geometry, material);
        
        // Kutuyu yerden yükselt (Merkezi ortada olduğu için)
        model.position.set(position.x, position.y + (dimensions.h / 2), position.z);
        model.rotation.set(rotation.x, rotation.y, rotation.z);
        model.userData = { ...userData, type: type };

        // Çarpışma Kontrolü
        if (position.y < 0.1 && !userData.isWall) {
            // findSafePosition'a (x,y,z) objesi gönderiyoruz
            const safePos = findSafePosition(model, {x: position.x, y: position.y, z: position.z});
            model.position.set(safePos.x, safePos.y + (dimensions.h / 2), safePos.z);
        }

        scene.add(model);
        console.log(` Kutu Eklendi: ${type}`);
    }
}
// --- 3. NLP & BACKEND İLETİŞİMİ ---
async function parseSentence(sentence) {
    console.log(" Backend'e soruluyor:", sentence);

    try {
        const response = await fetch('http://127.0.0.1:8000/api/generate-scene', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: sentence })
        });

        const sceneData = await response.json();
        console.log(" Backend'den gelen veri:", sceneData);

        // Baseline (LLM-only): Bu satır aktif edilirse spatial inference atlanır ve doğrudan LLM çıktısı kullanılır. 
        //const inferredData = sceneData; // no spatial inference

        // Current System:
        const inferredData = applySpatialInference(sceneData);
        window.lastSceneData = inferredData; //Traversability kodu için eklendi

        // Spatial sonrası veriyi log'a gönderir
        fetch('http://127.0.0.1:8000/api/log-spatial', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text: sentence, scene: inferredData })
        }).catch(err => console.warn('Spatial log hatası:', err));

        if (sceneData.error) {
            console.error("Backend Hatası:", sceneData.error);
            alert("Hata: " + sceneData.error);
            return;
        }

        if (inferredData.assets) {
            // Eski acil çıkış çizgilerini temizle
            if (window.emergencyLines && window.emergencyLines.length > 0) {
                window.emergencyLines.forEach(line => scene.remove(line));
                window.emergencyLines = [];
            }
            window.emergencyLines = [];

            // Objeleri yerleştir
            inferredData.assets.forEach(asset => {
                placeAssetInScene(asset, inferredData.relations, inferredData);
            });

            // Yol hesaplama
            setTimeout(() => {
                drawEmergencyPath();
                updateAssistantPanel(inferredData);
                printEvaluationReport(inferredData, sentence); 
            }, 2000);
        }

    } catch (error) {
        console.error("! Bağlantı Hatası:", error);
        alert("Backend kapalı olabilir!");
    }
}

// --- 4. SAHNE YERLEŞİM MANTIĞI ---

function placeAssetInScene(asset, allRelations, sceneData) {


    const assetLibrary = {
        // GRUP 1: GLTF MODELLER (Gerçekçi 3D Modeller)
        "window": { 
            isGLTF: true, 
            path: "objects/window_1/window_1.glb", 
            scale: 0.5 
        },
        "door": { 
            isGLTF: true, 
            path: "objects/door_1/door_1.glb", 
            scale: 0.04 
        },
        "victim": { 
            isGLTF: true, 
            path: "objects/standing_person/person1.glb", 
            scale: 3 
        },
        "person": { 
            isGLTF: true, 
            path: "objects/standing_person/person1.glb", 
            scale: 3 
        },
        "injured": { 
            isGLTF: true, 
            path: "objects/lying_person/aiden_sterling.glb", 
            scale: 3 
        },
        
        // GRUP 2: MOBİLYALAR (Kutu Modeller)
        // Gerçek boyutlar: İnsan 1.8m referans alındı
        
        "bed": { 
            isGLTF: false, 
            w: 5.0,  // 1.5m genişlik 
            h: 1.5,  // 0.5m yükseklik
            d: 6.5,  // 2.0m uzunluk
            color: 0xecf0f1  
        },
        
        "table": { 
            isGLTF: false, 
            w: 5.0,  // 1.5m genişlik 
            h: 2.4,  // 0.8m yükseklik 
            d: 3.0,  // 1.0m derinlik
            color: 0x8b5a2b  
        },
        
        "sofa": { 
            isGLTF: false, 
            w: 7.5,  // 2.5m genişlik
            h: 2.5,  // 0.85m yükseklik
            d: 3.0,  // 1.0m derinlik
            color: 0x2c3e50  
        },
        
        "couch": { 
            isGLTF: false, 
            w: 7.5,  // Sofa ile aynı
            h: 2.5, 
            d: 3.0, 
            color: 0x34495e  
        },
        
        "chair": { 
            isGLTF: false, 
            w: 1.5,  // 0.5m genişlik
            h: 3.0,  // 1.0m yükseklik
            d: 1.5,  // 0.5m derinlik
            color: 0xd35400  
        },
        
        "armchair": { 
            isGLTF: false, 
            w: 2.5,  // 0.85m genişlik 
            h: 2.7,  // 0.9m yükseklik
            d: 2.5,  // 0.85m derinlik
            color: 0x16a085  // Turkuaz
        },
        
        "closet": { 
            isGLTF: false, 
            w: 4.0,  // 1.2m genişlik 
            h: 7.0,  // 2.2m yükseklik 
            d: 2.0,  // 0.6m derinlik
            color: 0x8e44ad  
        },
        
        "wardrobe": { 
            isGLTF: false, 
            w: 5.0,  // 1.5m genişlik
            h: 7.0,  // 2.2m yükseklik
            d: 2.0,  // 0.6m derinlik
            color: 0x9b59b6  
        },
        
        // GRUP 3: KÜÇÜK EŞYALAR ve DEKORASYONLAR
        
        "tv": { 
            isGLTF: false, 
            w: 3.5,  // 1.1m genişlik 
            h: 2.0,  // 0.65m yükseklik 
            d: 0.5,  // 0.15m derinlik 
            color: 0x2c3e50  
        },
        "lamp": { 
            isGLTF: false, 
            w: 0.8,  // 0.25m genişlik 
            h: 1.5,  // 0.5m yükseklik
            d: 0.8,  // 0.25m derinlik
            color: 0xf39c12  
        },
        
        "nightstand": { 
            isGLTF: false, 
            w: 1.5,  // 0.5m genişlik
            h: 1.8,  // 0.6m yükseklik
            d: 1.2,  // 0.4m derinlik
            color: 0x7f8c8d  
        },
        
        "bookshelf": { 
            isGLTF: false, 
            w: 3.0,  // 1.0m genişlik 
            h: 6.0,  // 2.0m yükseklik
            d: 1.0,  // 0.3m derinlik
            color: 0xa0522d 
        },
        
        "desk": { 
            isGLTF: false, 
            w: 4.5,  // 1.4m genişlik 
            h: 2.4,  // 0.75m yükseklik
            d: 2.5,  // 0.8m derinlik
            color: 0x795548 
        },
        
        // GRUP 4: ACİL DURUM EKIPMANLARI
        
        "fire_extinguisher": { 
            isGLTF: false, 
            w: 0.5,  // 0.15m genişlik 
            h: 1.2,  // 0.4m yükseklik
            d: 0.5,  // 0.15m derinlik
            color: 0xe74c3c  
        },
        
        "extinguisher": { 
            isGLTF: false, 
            w: 0.5, 
            h: 1.2, 
            d: 0.5, 
            color: 0xe74c3c
        },
        
        "first_aid": { 
            isGLTF: false, 
            w: 1.5,  // 0.5m genişlik 
            h: 1.0,  // 0.3m yükseklik
            d: 1.0,  // 0.3m derinlik
            color: 0xffffff  
        },
        
        "stretcher": { 
            isGLTF: false, 
            w: 2.0,  // 0.6m genişlik 
            h: 0.8,  // 0.25m yükseklik
            d: 6.0,  // 1.8m uzunluk
            color: 0xbdc3c7  
        },
        
        "wheelchair": { 
            isGLTF: false, 
            w: 2.0,  // 0.6m genişlik 
            h: 3.0,  // 1.0m yükseklik
            d: 2.5,  // 0.8m derinlik
            color: 0x34495e  
        },
        
        "oxygen_tank": { 
            isGLTF: false, 
            w: 0.6,  // 0.2m genişlik 
            h: 2.0,  // 0.6m yükseklik
            d: 0.6,  // 0.2m derinlik
            color: 0x3498db  
        },
        
        // GRUP 5: ENKAZ ve HASAR OBJELERİ
        
        "rubble": { 
            isGLTF: false, 
            w: 3.0,  // 1.0m genişlik (moloz yığını)
            h: 2.0,  // 0.6m yükseklik
            d: 3.0,  // 1.0m derinlik
            color: 0x7f8c8d  
        },
        "debris": { 
            isGLTF: false, 
            w: 2.5,  // 0.8m genişlik (enkaz)
            h: 1.5,  // 0.5m yükseklik
            d: 2.5,  // 0.8m derinlik
            color: 0x95a5a6 
        },
        
        "broken_wall": { 
            isGLTF: false, 
            w: 5.0,  // 1.5m genişlik 
            h: 4.0,  // 1.2m yükseklik
            d: 1.0,  // 0.3m kalınlık
            color: 0x95a5a6  
        },
        
        "concrete": { 
            isGLTF: false, 
            w: 2.0,  // 0.6m genişlik (beton blok)
            h: 2.0,  // 0.6m yükseklik
            d: 2.0,  // 0.6m derinlik
            color: 0x7f8c8d  
        },
        
        "obstacle": { 
            isGLTF: false, 
            w: 2.5, 
            h: 2.0, 
            d: 2.5, 
            color: 0xe67e22  
        }
    };

    const matchedKey = Object.keys(assetLibrary).find(key => asset.type.includes(key));
    if (!matchedKey) return; 

    const props = assetLibrary[matchedKey];
    // scale_modifier varsa boyutlara uygula
    console.log(` [Scale Debug - Before scale] ${asset.type} | initial weight=${props.w}`);
    const scaleModifier = asset.scale_modifier ; 
    if (!props.isGLTF) {
        props.w = props.w * scaleModifier;
        props.h = props.h * scaleModifier;
        props.d = props.d * scaleModifier;
    } else {
        props.scale = props.scale * scaleModifier;
    }

    console.log(` [Scale Debug] ${asset.type} | scale_modifier=${asset.scale_modifier} | scaleModifier=${scaleModifier} | final w=${props.w}`);

    // Konum hesaplama (göreceli konumlandırma)
    let position = { x: 0, y: 0, z: 0 };
    let rotation = { x: 0, y: 0, z: 0 };
    const myRelation = allRelations.find(rel => rel.source_id === asset.id);
    const relationType = myRelation ? myRelation.relation : "center";
    const targetId = myRelation ? myRelation.target_id : "room";

    const isWallType = (asset.placement_type === 'wall' || asset.type.includes("window") || asset.type.includes("door"));
    const isExitType = asset.type.includes("door") || asset.type.includes("window");

    // On wall ilişkisi -- 
    // LLM bazen "left_wall", "back_wall" gibi target_id kullanır
    // --- Durum 1: on_wall veya x_wall target ise
    // LLM  zemin objelerini duvara yerleştirmek isterse
    if (relationType.includes("on_wall") || targetId.includes("wall")) {
        // Target'tan duvarı çıkar
        let wallSide = "";
        
        if (targetId.includes("left") || relationType.includes("left")) {
            wallSide = "left";
        } else if (targetId.includes("right") || relationType.includes("right")) {
            wallSide = "right";
        } else if (targetId.includes("back") || relationType.includes("behind")) {
            wallSide = "back";
        } else if (targetId.includes("front")) {
            wallSide = "front";
        }
        
        console.log(` [Debug] ${asset.type} → ${wallSide} duvarına yerleştiriliyor`);
        
        // Zemin objesi/Duvar objesi
        const isFloorObject = !asset.type.includes("door") && !asset.type.includes("window");
        
        // Duvar tipine göre pozisyon
        if (wallSide === "left") {
            if (isFloorObject) {
                // Zemin objesi → Duvara yakın ama oda içinde olması için -6
                position.x = -6;
                position.z = 0;
                position.y = 0;
                rotation.y = Math.PI / 2; // Sola bak
            } else {
                // Duvar objesi (pencere/kapı) → Duvara yapıştır
                position.x = -9.9;
                position.z = 0;
                rotation.y = Math.PI / 2;
                position.y = asset.type.includes("door") ? 4 : 3;
            }
        } else if (wallSide === "right") {
            if (isFloorObject) {
                position.x = 6;
                position.z = 0;
                position.y = 0;
                rotation.y = -Math.PI / 2;
            } else {
                position.x = 9.9;
                position.z = 0;
                rotation.y = -Math.PI / 2;
                position.y = asset.type.includes("door") ? 4 : 3;
            }
        } else if (wallSide === "front") {
            if (isFloorObject) {
                position.x = 0;
                position.z = -6;
                position.y = 0;
                rotation.y = Math.PI; 
            } else {
                position.x = 0;
                position.z = -9.9;
                rotation.y = 0;
                position.y = asset.type.includes("door") ? 4 : 3;
            }
        } else if (wallSide === "back") {
            if (isFloorObject) {
                position.x = 0;
                position.z = 6;
                position.y = 0;
                rotation.y = 0; 
            } else {
                position.x = 0;
                position.z = 9.9;
                rotation.y = Math.PI;
                position.y = asset.type.includes("door") ? 4 : 3;
            }
        }
        
        if (asset.type.includes("door") && !isFloorObject) rotation.y += Math.PI / 2;
    }
    // Duvar Objeleri : Kapı, pencere
    else if (isWallType) {
        position.y = 3; // Pencereler yerden 3 birim yukarıda
        if (asset.type.includes("door")) position.y = 4; // Kapılar zeminde

        // SOL DUVAR
        if (relationType.includes("left")) {
            position.x = -9.9; 
            position.z = relationType.includes("behind") ? 5 : (relationType.includes("front") ? -5 : 0);
            rotation.y = Math.PI / 2;
        } 
        // SAĞ DUVAR
        else if (relationType.includes("right")) {
            position.x = 9.9; 
            position.z = relationType.includes("behind") ? 5 : (relationType.includes("front") ? -5 : 0);
            rotation.y = -Math.PI / 2;
        } 
        // ARKA DUVAR
        else if (relationType.includes("behind") || relationType.includes("back")) {
            position.z = 9.9; 
            position.x = relationType.includes("left") ? -5 : (relationType.includes("right") ? 5 : 0);
            rotation.y = Math.PI;
        } 
        // ÖN DUVAR
        else {
            position.z = -9.9; 
            position.x = relationType.includes("left") ? -5 : (relationType.includes("right") ? 5 : 0);
            rotation.y = 0;
        }
        
        if (asset.type.includes("door")) rotation.y += Math.PI / 2;

    }
     
    // Mobilya ve zemin objeleri 
    else {
        // Hedef room ise, belirli konum (odanın sol/sağ/merkezi)
        if (targetId === "room") {
            if (relationType.includes("left")) position.x = -5;
            else if (relationType.includes("right")) position.x = 5;
            else if (relationType.includes("center")) position.x = 0;
            
            if (relationType.includes("behind")) position.z = 5;
            else if (relationType.includes("front")) position.z = -5;
            else if (relationType.includes("center")) position.z = 0;
        } 
        // Hedef başka bir obje ise göreceli konum
        else {
            const targetAsset = sceneData.assets.find(a => a.id === targetId);
            
            if (targetAsset) {
                const targetObject = scene.children.find(obj => 
                    obj.userData && obj.userData.type === targetAsset.type
                );
                
                if (targetObject) {
                    position.x = targetObject.position.x;
                    position.z = targetObject.position.z;
                    
                    const targetBox = new THREE.Box3().setFromObject(targetObject);
                    const targetSize = new THREE.Vector3();
                    targetBox.getSize(targetSize);
                    
                    const offset = 2;

                    if (relationType.includes("left_of") || relationType.includes("to_left")) {
                        position.x = targetObject.position.x - (targetSize.x / 2) - offset;
                    }
                    else if (relationType.includes("right_of") || relationType.includes("to_right")) {
                        position.x = targetObject.position.x + (targetSize.x / 2) + offset;
                    }

                    if (relationType.includes("in_front_of") || relationType.includes("front")) {
                        position.z = targetObject.position.z - (targetSize.z / 2) - offset;
                    }
                    else if (relationType.includes("behind")) {
                        position.z = targetObject.position.z + (targetSize.z / 2) + offset;
                    }

                    if (relationType.includes("next_to")) {
                        const side = Math.random() > 0.5 ? 1 : -1;
                        position.x = targetObject.position.x + ((targetSize.x / 2) + offset) * side;
                        position.z = targetObject.position.z;
                        position.y = 0;
                        
                        console.log(`[Debug] ${asset.type} → ${targetId} yanına yerleştirildi (side: ${side > 0 ? 'sağ' : 'sol'})`);
                    }
                    
                    if (relationType.includes("on")) {
                        position.x = targetObject.position.x;
                        position.z = targetObject.position.z;
                        position.y = targetObject.position.y + (targetSize.y / 2);
                    }

                    if (relationType.includes("around")) {
                        const angle = Math.random() * Math.PI * 2;
                        const distance = (targetSize.x / 2) + offset;
                        position.x = targetObject.position.x + Math.cos(angle) * distance;
                        position.z = targetObject.position.z + Math.sin(angle) * distance;
                    }
                } else {
                    console.warn(` Hedef obje '${targetId}' henüz yerleştirilmedi, merkeze koyuluyor.`);
                    position.x = 0;
                    position.z = 0;
                }
            }
        }
    }

    console.log(` WINDOW DEBUG: relation="${relationType}", target="${targetId}", y=${position.y}`);

    const extraData = {
        isWall: isWallType || asset.type.includes("window") || asset.type.includes("door"),
        isExit: isExitType,
        isObstacle: !isExitType && !isWallType,
        source_id: asset.id, 
        relation: relationType,
        target_id: targetId,
        traversability: asset.traversability || 'blocked'  // traversability için eklendi 
    };
    console.log(` ${asset.type} pozisyonu:`, position, `(hedef: ${targetId}, ilişki: ${relationType})`);

    // Fonksiyona Gönder
    addModel(matchedKey, {
        isGLTF: props.isGLTF,        
        path: props.path,            
        scale: props.isGLTF ? {x: props.scale, y: props.scale, z: props.scale} : null,
        dimensions: props.isGLTF ? null : { w: props.w, h: props.h, d: props.d },
        color: props.color,
        position: position,
        rotation: rotation,
        userData: extraData
    });
}
// --- 5. PATHFINDING (BFS ALGORİTMASI) ---
function drawEmergencyPath() {
    console.log(" Emergency Path Hesaplanıyor...");

    const gridSize = 20;
    const gridOffset = 10;
    
    if (window.emergencyLines && window.emergencyLines.length > 0) {
        window.emergencyLines.forEach(line => scene.remove(line));
        window.emergencyLines = [];
    }
    window.emergencyLines = [];

    // 1. KULLANICIYI BUL
    let startNode = null;
    scene.children.forEach(obj => {
        if (obj.userData && obj.userData.isUser) {
            startNode = { 
                x: Math.floor(obj.position.x + gridOffset), 
                y: Math.floor(obj.position.z + gridOffset) 
            };
        }
    });
    if (!startNode) return;

    // 2. ÇIKIŞLARI BUL
    let allExits = [];
    scene.children.forEach(obj => {
        if (obj.userData && obj.userData.isExit) {
            const gx = Math.floor(obj.position.x + gridOffset);
            const gz = Math.floor(obj.position.z + gridOffset);
            allExits.push({ 
                x: Math.max(0, Math.min(gridSize - 1, gx)), 
                y: Math.max(0, Math.min(gridSize - 1, gz)), 
                targetHeight: obj.position.y, // Hedefin (pencerenin) yüksekliği
                object: obj 
            });
        }
    });

    // 3. GRID VE YÜKSEKLİK HARİTASI OLUŞTUR 
    // Hem engel var mı yok mu, hem de varsa yüksekliği nedir bilgisi tutulacak
    let grid = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
    const TRAVERSABLE_HEIGHT_LIMIT = 1.6; 

    scene.children.forEach(obj => {
        if (obj.userData && obj.userData.isObstacle) {
            const box = new THREE.Box3().setFromObject(obj);
            const height = box.max.y; // Objenin yerden en tepe noktası
            
            const minX = Math.floor(box.min.x + gridOffset);
            const maxX = Math.floor(box.max.x + gridOffset);
            const minZ = Math.floor(box.min.z + gridOffset);
            const maxZ = Math.floor(box.max.z + gridOffset);

            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    if (x >= 0 && x < gridSize && z >= 0 && z < gridSize) {

                        const traversability = obj.userData.traversability || null;

                        if (traversability === 'blocked' || (!traversability && height >= TRAVERSABLE_HEIGHT_LIMIT)) {
                            grid[z][x] = Infinity;
                        } else if (traversability === 'passable') {
                            // Geçilebilir, grid değişmez
                        } else {
                            // walkable_over veya fallback
                            grid[z][x] = Math.max(grid[z][x], height);
                        }
                    }
                }
            }
        }
    });

    // 4. YOLLARI HESAPLA VE ÇİZ 
    let allPaths = [];
    allExits.forEach((exit, index) => {
        
        //const pathPoints = findPathBFS(startNode, exit, grid, gridSize);
        const pathPoints = findPathAStar(startNode, exit, grid, gridSize);

        if (pathPoints && pathPoints.length > 1) {
            const isShortest = (index === 0);
            const color = isShortest ? 0x00ff00 : 0xff0000;
            const radius = isShortest ? 0.15 : 0.08; // Çizgi kalınlığı

            const curve = new THREE.CatmullRomCurve3(pathPoints);
            
            const geometry = new THREE.TubeGeometry(curve, pathPoints.length * 8, radius, 8, false);
            
            const material = new THREE.MeshStandardMaterial({ 
                color: color, 
                emissive: color,
                emissiveIntensity: 0.6,
                roughness: 0.3,
                metalness: 0.1
            });
            
            const tube = new THREE.Mesh(geometry, material);
            scene.add(tube);
            window.emergencyLines.push(tube);

            allPaths.push({ points: pathPoints, distance: calculatePathDistance(pathPoints) });
        }
    });

    // Dashboard güncellemesi için veriyi kaydet
    if (allPaths.length > 0) {
        allPaths.sort((a, b) => a.distance - b.distance);
        window.pathMetrics = {
            distance: (allPaths[0].distance * 0.25).toFixed(1),
            steps: allPaths[0].points.length,
            complexity: calculatePathComplexity(allPaths[0].points)
        };
    }
}

// function findPathBFS(startNode, endNode, grid, gridSize) {
//     let queue = [startNode];
//     let visited = Array(gridSize).fill().map(() => Array(gridSize).fill(false));
//     let parent = Array(gridSize).fill().map(() => Array(gridSize).fill(null));

//     // Başlangıç kontrolü
//     if (startNode.x >= 0 && startNode.x < gridSize && startNode.y >= 0 && startNode.y < gridSize) {
//         visited[startNode.y][startNode.x] = true;
//     } else { return null; }

//     const dx = [1, -1, 0, 0];
//     const dy = [0, 0, 1, -1];
//     let found = false;
//     let finalNode = null;

//     // BFS Algoritması
//     while (queue.length > 0) {
//         let current = queue.shift();

//         // Hedefe ulaştı mı?
//         if (Math.abs(current.x - endNode.x) <= 2 && Math.abs(current.y - endNode.y) <= 2) {
//             finalNode = current;
//             found = true;
//             break;
//         }

//         for (let i = 0; i < 4; i++) {
//             let nx = current.x + dx[i];
//             let ny = current.y + dy[i];

//             if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
//                 if (!visited[ny][nx] && grid[ny][nx] !== Infinity) {
//                     visited[ny][nx] = true;
//                     parent[ny][nx] = current;
//                     queue.push({ x: nx, y: ny });
//                 }
//             }
//         }
//     }

//     if (!found) return null;

//     // 3D noktaları oluştur (Eğer walkable over olan bir objeden geçecekse
//     const pathPoints = [];
//     let curr = finalNode;
//     const gridOffset = 10;

//     // Hedef noktayı ekle
//     if (endNode.targetHeight !== undefined) {
//          pathPoints.push(new THREE.Vector3(
//             curr.x - gridOffset, 
//             endNode.targetHeight,
//             curr.y - gridOffset
//         ));
//     }

//     while (curr) {
//         // Grid'deki  karenin yüksekliği alınır
//         let obstacleHeight = grid[curr.y][curr.x];
        
    
//         let drawHeight = obstacleHeight > 0 ? (obstacleHeight + 0.4) : 0.2;

//         pathPoints.push(new THREE.Vector3(
//             curr.x - gridOffset, 
//             drawHeight, 
//             curr.y - gridOffset
//         ));

//         curr = parent[curr.y][curr.x];
//     }
    
//     return pathPoints.reverse();
// }

function findPathAStar(startNode, endNode, grid, gridSize) {
    // --- SINIR KONTROLÜ ---
    if (startNode.x < 0 || startNode.x >= gridSize || 
        startNode.y < 0 || startNode.y >= gridSize) return null;

    // --- HEURİSTİK: Manhattan mesafesi ---
    function heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    // --- VERİ YAPILARI ---
    // gCost: başlangıçtan bu noktaya gerçek maliyet
    // fCost: gCost + heuristic (tahmin)
    const gCost = Array(gridSize).fill(null).map(() => Array(gridSize).fill(Infinity));
    const parent = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null));
    const closed = Array(gridSize).fill(null).map(() => Array(gridSize).fill(false));

    gCost[startNode.y][startNode.x] = 0;

    // Open list: { x, y, f } objelerini tutar, f'ye göre sıralı
    // Basit dizi olarak tutuyoruz, her adımda en düşük f'yi çekiyoruz
    let openList = [{ 
        x: startNode.x, 
        y: startNode.y, 
        f: heuristic(startNode, endNode) 
    }];

    const dx = [1, -1, 0, 0];
    const dy = [0, 0, 1, -1];

    let found = false;
    let finalNode = null;

    // --- A* ANA DÖNGÜSÜ ---
    while (openList.length > 0) {
        // En düşük f değerli düğümü seç
        openList.sort((a, b) => a.f - b.f);
        const current = openList.shift();

        // Zaten işlendiyse geç
        if (closed[current.y][current.x]) continue;
        closed[current.y][current.x] = true;

        // Hedefe ulaştık mı?
        if (Math.abs(current.x - endNode.x) <= 2 && 
            Math.abs(current.y - endNode.y) <= 2) {
            finalNode = current;
            found = true;
            break;
        }

        // --- KOMŞULARI İŞLE ---
        for (let i = 0; i < 4; i++) {
            const nx = current.x + dx[i];
            const ny = current.y + dy[i];

            if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
            if (closed[ny][nx]) continue;
            if (grid[ny][nx] === Infinity) continue; // Engel

            const newG = gCost[current.y][current.x] + 1;

            if (newG < gCost[ny][nx]) {
                gCost[ny][nx] = newG;
                parent[ny][nx] = current;
                const f = newG + heuristic({ x: nx, y: ny }, endNode);
                openList.push({ x: nx, y: ny, f: f });
            }
        }
    }

    if (!found) return null;

    // --- 3D NOKTALARI OLUŞTUR (BFS ile aynı mantık korundu) ---
    const pathPoints = [];
    let curr = finalNode;
    const gridOffset = 10;

    if (endNode.targetHeight !== undefined) {
        pathPoints.push(new THREE.Vector3(
            curr.x - gridOffset,
            endNode.targetHeight,
            curr.y - gridOffset
        ));
    }

    while (curr) {
        let obstacleHeight = grid[curr.y][curr.x];
        let drawHeight = obstacleHeight > 0 ? (obstacleHeight + 0.4) : 0.2;

        pathPoints.push(new THREE.Vector3(
            curr.x - gridOffset,
            drawHeight,
            curr.y - gridOffset
        ));

        curr = parent[curr.y][curr.x];
    }

    return pathPoints.reverse();
}

/*
Yolun toplam mesafesini hesapla
*/
function calculatePathDistance(pathPoints) {
    let total = 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
        total += pathPoints[i].distanceTo(pathPoints[i + 1]);
    }
    return total;
}

// Yolun ne kadar dolambaçlı olduğunu hesapla
function calculatePathComplexity(pathPoints) {
    if (pathPoints.length < 3) return "Simple";
    
    let turnCount = 0;
    for (let i = 1; i < pathPoints.length - 1; i++) {
        const v1 = new THREE.Vector3().subVectors(pathPoints[i], pathPoints[i-1]);
        const v2 = new THREE.Vector3().subVectors(pathPoints[i+1], pathPoints[i]);
        
        const angle = v1.angleTo(v2);
        if (angle > 0.5) turnCount++;
    }
    
    if (turnCount === 0) return "Direct";
    if (turnCount <= 2) return "Simple";
    if (turnCount <= 5) return "Moderate";
    return "Complex";
}

// --- 6. ASİSTAN PANELİ ---

function updateAssistantPanel(sceneData) {
        const alertBox = document.getElementById('obstacle-alert'); 
        const statusBadge = document.getElementById('status-badge');
        statusBadge.textContent = '● SCANNING';
        statusBadge.className = 'scanning';
        
        setTimeout(() => {
            statusBadge.textContent = '✓ COMPLETE';
            statusBadge.className = 'complete';
        }, 1500);

        const exitTable = document.getElementById('exit-table-body');
        const relTable = document.getElementById('relation-table-body');
        
        exitTable.innerHTML = "";
        relTable.innerHTML = "";

        scene.children.forEach(obj => {
            if (!obj.userData) return;

            // A) EXIT POINTS (Tüm kapı ve pencereler)
            if (obj.userData.isExit) {
                const row = document.createElement('tr');
                const isAccessible = window.emergencyLines && window.emergencyLines.length > 0; 
                
                // Yön hesaplama
                let direction = obj.position.x < -2 ? "LEFT " : (obj.position.x > 2 ? "RIGHT " : "CENTER ");
                direction += obj.position.z < -2 ? "FRONT" : (obj.position.z > 2 ? "BACK" : "");

                row.innerHTML = `
                    <td>${obj.userData.type}</td>
                    <td>${direction}</td>
                    <td><span style="color: ${isAccessible ? '#2ecc71' : '#e74c3c'};">${isAccessible ? '✓ ACCESSIBLE' : '✗ BLOCKED'}</span></td>
                `;
                exitTable.appendChild(row);
            }

            // B) SPATIAL RELATIONSHIPS (Tüm yerleşmiş objelerin ilişkileri)
            if (obj.userData.source_id && obj.userData.relation) {
                const row = document.createElement('tr');
                const readableRel = formatRelation(obj.userData.relation);
                
                row.innerHTML = `
                    <td style="color: #3498db; font-weight: 600;">${obj.userData.source_id}</td>
                    <td>${readableRel}</td>
                    <td style="color: #9b59b6;">${obj.userData.target_id}</td>
                `;
                relTable.appendChild(row);
            }
        });

        // C) OBSTACLES ALERT
        const obstacleCount = sceneData.assets.filter(a => 
            !a.type.includes("door") && !a.type.includes("window")
        ).length;
        
        if (obstacleCount > 0) {
            alertBox.innerHTML = `⚠️ <strong>Caution:</strong> ${obstacleCount} obstacle(s) detected on path.`;
            alertBox.style.cssText = `
                background: rgba(230, 126, 34, 0.15);
                border-color: #e67e22;
                color: #e67e22;
            `;
        }
        // D) PATH METRICS
        if (window.pathMetrics) {
            const distance = parseFloat(window.pathMetrics.distance);
            const walkingSpeed = 1.4; // m/s (Normal yürüyüş hızı)
            const runningSpeed = 4.0; // m/s (Koşma hızı)
            
            const timeWalk = (distance / walkingSpeed).toFixed(1);
            const timeRun = (distance / runningSpeed).toFixed(1);
            
            // Elementler güncellenir
            document.getElementById('distance-value').textContent = distance + ' m';
            document.getElementById('time-walk').textContent = timeWalk + ' sec';
            document.getElementById('time-run').textContent = timeRun + ' sec';
            document.getElementById('path-complexity').textContent = window.pathMetrics.complexity;
            
            // Renk uyarısı (10 metreden fazlaysa sarı, 20'den fazlaysa kırmızı)
            const distanceElement = document.getElementById('distance-value');
            const timeWalkElement = document.getElementById('time-walk');
            
            if (distance > 20) {
                distanceElement.classList.add('danger');
                timeWalkElement.classList.add('danger');
            } else if (distance > 10) {
                distanceElement.classList.add('warning');
                timeWalkElement.classList.add('warning');
            } else {
                distanceElement.classList.remove('warning', 'danger');
                timeWalkElement.classList.remove('warning', 'danger');
            }
        } else {
            // Yol yoksa default değerler
            document.getElementById('distance-value').textContent = '-- m';
            document.getElementById('time-walk').textContent = '-- sec';
            document.getElementById('time-run').textContent = '-- sec';
            document.getElementById('path-complexity').textContent = '--';
        }
}


function addListItem(html, color) {
    const list = document.getElementById('analysis-list');
    const li = document.createElement('li');
    li.style.color = color;
    li.innerHTML = html;
    list.appendChild(li);
}

function formatRelation(rel) {
    if (rel.includes("left")) return "to LEFT of";
    if (rel.includes("right")) return "to RIGHT of";
    if (rel.includes("front")) return "in FRONT of";
    if (rel.includes("behind")) return "BEHIND";
    return rel;
}

// --- 7. ÇARPIŞMA & YARDIMCILAR ---
function checkCollision(model, testPosition) {
    model.position.set(testPosition.x, testPosition.y, testPosition.z);
    model.updateMatrixWorld();
    const box1 = new THREE.Box3().setFromObject(model);
    box1.expandByScalar(0.1); 

    for (let i = 0; i < scene.children.length; i++) {
        const other = scene.children[i];
        if (other === model || other.isLight || other === window.emergencyLine) continue;
        if (other.geometry && other.geometry.type === "PlaneGeometry") continue;

        const box2 = new THREE.Box3().setFromObject(other);
        if (box1.intersectsBox(box2)) return true;
    }
    return false;
}

function findSafePosition(model, preferredPosition) {
    let bestPosition = { ...preferredPosition };
    if (!checkCollision(model, bestPosition)) return bestPosition;

    let attempt = 0;
    while (attempt < 100) {
        attempt++;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (attempt * 0.5);
        const candidate = {
            x: preferredPosition.x + Math.cos(angle) * radius,
            y: preferredPosition.y,
            z: preferredPosition.z + Math.sin(angle) * radius
        };
        if (!checkCollision(model, candidate)) return candidate;
    }
    return preferredPosition;
}
// --- EVALUATION REPORT ---
function printEvaluationReport(sceneData, inputSentence) {
    setTimeout(() => {
        const report = buildReport(sceneData, inputSentence);
        
        // Browser console'a bas
        console.log(report.consoleText);


        fetch('http://127.0.0.1:8000/api/log-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report.data)
        }).catch(() => {}); 
    }, 500);
}

function buildReport(sceneData, inputSentence) {
    const placements = [];
    let exitCount = 0;
    let pathFound = !!(window.pathMetrics);
    let pathDist = pathFound ? window.pathMetrics.distance + 'm' : 'N/A';
    let pathComplexity = pathFound ? window.pathMetrics.complexity : 'N/A';

    scene.children.forEach(obj => {
        if (!obj.userData || !obj.userData.type) return;
        if (obj.userData.isUser) return;
        if (obj.isLight || obj.type === 'HemisphereLight' || obj.type === 'AmbientLight') return;
        if (obj.geometry && (obj.geometry.type === 'PlaneGeometry')) return;

        const p = obj.position;
        const inBounds = Math.abs(p.x) <= 9.5 && Math.abs(p.z) <= 9.5;
        let wallSnap = 'N/A';
        if (obj.userData.isWall) {
            wallSnap = (Math.abs(p.x) >= 9.4 || Math.abs(p.z) >= 9.4) ? 'PASS' : 'FAIL';
        }
        if (obj.userData.isExit) exitCount++;

        placements.push({
            type: obj.userData.type,
            x: parseFloat(p.x.toFixed(2)),
            y: parseFloat(p.y.toFixed(2)),
            z: parseFloat(p.z.toFixed(2)),
            inBounds,
            wallSnap,
            relation: obj.userData.relation || '-',
            target: obj.userData.target_id || '-'
        });
    });

    // Console text 
    const sep = '='.repeat(65);
    const lines = [
        sep,
        ' EVALUATION REPORT',
        sep,
        `  INPUT : "${inputSentence}"`,
        '-'.repeat(65),
        '  PLACEMENTS:',
        ...placements.map(p =>
            `    [${p.type.padEnd(16)}]  ` +
            `x=${String(p.x).padStart(6)}  y=${String(p.y).padStart(5)}  z=${String(p.z).padStart(6)}  ` +
            `| bounds=${p.inBounds?'✓':'✗'}  ` +
            `| wall=${p.wallSnap.padEnd(4)}  ` +
            `| rel=${p.relation}`
        ),
        '-'.repeat(65),
        `  PATH   : ${pathFound ? '✓ FOUND' : '✗ NOT FOUND'}  dist=${pathDist}  complexity=${pathComplexity}`,
        `  EXITS  : ${exitCount}`,
        sep,
        '>>> COPY TO EXCEL <<<',
        sep
    ];

    return {
        consoleText: lines.join('\n'),
        data: { input: inputSentence, placements, pathFound, pathDist, pathComplexity, exitCount }
    };
}
function setupNLPControls() {
    const btn = document.getElementById('btn-process');
    const input = document.getElementById('sentence-input');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', async () => {
        if (!input.value) return;
        newBtn.disabled = true;
        newBtn.innerText = "Thinking...";
        await parseSentence(input.value);
        newBtn.disabled = false;
        newBtn.innerText = "Generate Scene";
    });
}

// ---  KUTU ÜZERİNE YAZI YAZMA (CANVAS TEXTURE) ---
function createLabelTexture(text) {
    const canvas = document.createElement('canvas');
    const size = 256; // Doku kalitesi
    canvas.width = size;
    canvas.height = size;
    
    const ctx = canvas.getContext('2d');
    
    // 1. Arka Plan
    ctx.fillStyle = '#f0f0f0'; 
    ctx.fillRect(0, 0, size, size);
    
    // 2. Çerçeve
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, size, size);

    // 3. Yazı Ayarları
    ctx.fillStyle = '#000000'; 
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(text.toUpperCase(), size / 2, size / 2);
    
    return new THREE.CanvasTexture(canvas);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // --- Acil çıkış yollarını vurgulamak için çizgilere verilen efekt
    if (window.emergencyLines) {
        const time = Date.now() * 0.002; 
        window.emergencyLines.forEach((line, idx) => {
            if (line.material && line.material.emissiveIntensity !== undefined) {
                const pulse = Math.sin(time + idx * 0.5) * 0.3 + 0.5; // 0.2 - 0.8 arası
                line.material.emissiveIntensity = pulse;
            }
        });
    }
    
    renderer.render(scene, camera);
}
// Start
init();
setupNLPControls();

// Window resize event'ini günceller
window.addEventListener('resize', () => {
    const panelWidth = 400;
    const newWidth = window.innerWidth - panelWidth;
    const newHeight = window.innerHeight;
    
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize(newWidth, newHeight);
});